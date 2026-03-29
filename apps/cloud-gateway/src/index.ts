// ---------------------------------------------------------------------------
// RouteBox Cloud Gateway — entry point
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { cors } from "hono/cors";
import * as Sentry from "@sentry/bun";
import { log } from "./lib/logger";
import { incCounter, observeHistogram, incGauge, decGauge } from "./lib/metrics";
import { validateEnv } from "./lib/env";
import { initDatabase, checkDbHealth, sql } from "./lib/db-cloud";
import { initRedis, checkRedisHealth, closeRedis } from "./lib/redis";
import { initCloudProviders } from "./lib/key-pool";
import { errorHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import {
  rateLimitAuth,
  rateLimitApi,
  rateLimitAccount,
  rateLimitBilling,
} from "./middleware/rate-limit";
import authRoutes from "./routes/auth";
import billingRoutes from "./routes/billing";
import accountRoutes from "./routes/account";
import analyticsRoutes from "./routes/analytics";
import metricsRoutes from "./routes/metrics";
import proxyRoutes from "./routes/proxy";
import adminRoutes from "./routes/admin";
import marketplaceRoutes from "./routes/marketplace";
import { jwtAuth } from "./middleware/jwt-auth";
import type { CloudEnv } from "./types";

const app = new Hono<CloudEnv>();

// ── Global error handler — prevents stack-trace leaks in production ─────────
app.onError(errorHandler);

// ── Request ID — first middleware, sets X-Request-ID for all downstream ──────
app.use("*", requestIdMiddleware);

// ── CORS — restrict origins (configurable via CORS_ORIGINS env var) ─────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["tauri://localhost", "https://tauri.localhost", "https://api.routebox.dev", "https://app.routebox.dev", "http://localhost:5173"];

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Non-browser requests (Tauri desktop, curl, server-to-server)
      if (!origin) return "*";
      return ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);

// ── Security headers ─────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  // Allow landing page to be framed (e.g. link previews)
  c.header("X-Frame-Options", c.req.path === "/" ? "SAMEORIGIN" : "DENY");
  c.header("X-XSS-Protection", "0");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

// ── Request body size limit (2MB) ────────────────────────────────────────────
app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength) > 2 * 1024 * 1024) {
    return c.json(
      { error: { message: "Request body too large (max 2MB)", type: "invalid_request_error", param: null, code: "request_too_large" } },
      413,
    );
  }
  await next();
});

// ── Request logging + metrics ───────────────────────────────────────────────
app.use("*", async (c, next) => {
  const start = performance.now();
  incGauge("active_requests");
  try {
    await next();
  } finally {
    decGauge("active_requests");
    const durationMs = Math.round(performance.now() - start);
    const status = c.res.status;
    const method = c.req.method;
    const path = c.req.path;

    // Skip logging for health/metrics to reduce noise
    if (path !== "/health" && path !== "/metrics") {
      log.info("request", {
        requestId: c.get("requestId"),
        userId: c.get("userId") ?? undefined,
        method,
        path,
        status,
        durationMs,
      });
    }

    // Always record metrics
    incCounter("http_requests_total", { method, status: String(status) });
    observeHistogram("http_request_duration_ms", durationMs, { method });
  }
});

// ── Rate limiting ───────────────────────────────────────────────────────────
app.use("/auth/*", rateLimitAuth);
app.use("/billing/*", rateLimitBilling);

// ── Public routes (no auth required) ────────────────────────────────────────
app.route("/auth", authRoutes);
app.route("/billing", billingRoutes);

// ── Admin dashboard HTML (public — page has its own login form) ──────────────
import { adminHtml } from "./lib/admin-page";
app.get("/admin", (c) => c.redirect("/admin/"));
app.get("/admin/", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  return c.html(adminHtml);
});

// ── Admin API routes (own auth — checks ADMIN_EMAILS) ───────────────────────
app.route("/admin", adminRoutes);

// ── Landing page + static assets ─────────────────────────────────────────────
import { landingHtml } from "./lib/landing";
import { serveStaticFile } from "./lib/static";

app.get("/", (c) => {
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Cache-Control", "public, max-age=300");
  return c.html(landingHtml);
});

app.get("/static/*", async (c) => {
  const fileName = c.req.path.replace("/static/", "");
  const result = serveStaticFile(fileName);
  if (!result) return c.notFound();
  return new Response(result.data, {
    status: 200,
    headers: { "Content-Type": result.contentType, "Cache-Control": "public, max-age=86400, immutable" },
  });
});

// Shortcut: /favicon.ico
app.get("/favicon.ico", async (c) => {
  const result = serveStaticFile("favicon.ico");
  if (!result) return c.notFound();
  return new Response(result.data, {
    status: 200,
    headers: { "Content-Type": result.contentType, "Cache-Control": "public, max-age=86400, immutable" },
  });
});

// ── Unauthenticated utility routes ──────────────────────────────────────────
app.route("/metrics", metricsRoutes);
// Health check with 10s cache to reduce DB/Redis load from monitoring
let healthCache: { result: { status: string; db: boolean; redis: boolean }; expiresAt: number } | null = null;

app.get("/health", async (c) => {
  const now = Date.now();
  if (healthCache && now < healthCache.expiresAt) {
    const { result } = healthCache;
    return c.json(
      { ...result, timestamp: new Date().toISOString() },
      result.db ? 200 : 503,
    );
  }

  const dbOk = await checkDbHealth();
  const redisOk = await checkRedisHealth() ?? false;
  const status = dbOk ? "ok" : "degraded";
  healthCache = { result: { status, db: dbOk, redis: redisOk }, expiresAt: now + 1_000 };
  return c.json(
    { status, timestamp: new Date().toISOString(), db: dbOk, redis: redisOk },
    dbOk ? 200 : 503,
  );
});

// ── /v1/models — public (OpenAI-compatible discovery, needed by OpenClaw) ──
import { modelsHandler } from "./routes/proxy";
app.get("/v1/models", modelsHandler);

// ── Protected routes (JWT required) ─────────────────────────────────────────
app.use("/v1/*", jwtAuth);
app.use("/account/*", jwtAuth);

// Rate limiting for authenticated routes (after JWT so userId is available)
app.use("/v1/*", rateLimitApi);
app.use("/account/*", rateLimitAccount);

app.route("/account", accountRoutes);
app.route("/account", analyticsRoutes);
app.route("/v1", proxyRoutes);

// ── Marketplace (JWT required) ──────────────────────────────────────────
app.use("/marketplace/*", jwtAuth);
app.route("/marketplace", marketplaceRoutes);

// ── Startup ─────────────────────────────────────────────────────────────────
log.info("gateway_starting");

// Validate environment variables (fail-fast)
validateEnv();

// H5: Fail-fast if webhook secret is missing in production
if (!process.env.POLAR_WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === "production") {
    log.error("POLAR_WEBHOOK_SECRET not set — refusing to start in production");
    process.exit(1);
  }
  log.warn("POLAR_WEBHOOK_SECRET not set — webhook endpoint will reject all events");
}

// Init Sentry (before other services so it captures initialization errors)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1, // 10% performance sampling
    beforeSend(event) {
      // Strip sensitive headers
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });
  log.info("sentry_initialized");
}

// Init providers from env vars (DB not ready yet)
initCloudProviders();

// Init Redis (optional — falls back to in-memory rate limiting)
await initRedis();

// Init database (runs migrations including 004_admin_config.sql)
await initDatabase();

// Reload providers with DB-managed keys merged in
import {
  loadDbProviderKeys,
  ensureProviderAccessDefaults,
  loadProviderAccess,
} from "./lib/provider-config";

try {
  const dbKeys = await loadDbProviderKeys();
  if (dbKeys.length > 0) {
    initCloudProviders(dbKeys);
  }
  await ensureProviderAccessDefaults();
  await loadProviderAccess();

  // Load routing config cache (global default + per-user overrides)
  const { loadRoutingConfig } = await import("./lib/routing-config");
  await loadRoutingConfig();
} catch (err) {
  log.warn("provider_config_init_error", {
    error: err instanceof Error ? err.message : String(err),
    message: "DB provider config failed to load, using env-only providers",
  });
}

// Initialize admin alerts (circuit breaker notifications) — separate try-catch
// so a failure here doesn't mask provider config success
try {
  const { initAlerts } = await import("./lib/alerts");
  initAlerts();
} catch (err) {
  log.warn("alerts_init_error", {
    error: err instanceof Error ? err.message : String(err),
  });
}

// ── L4: Pending deductions retry worker (every 5 minutes) ───────────────────
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const MAX_DEDUCTION_RETRIES = 3;
let retryTimer: ReturnType<typeof setInterval> | null = null;

async function processPendingDeductions() {
  try {
    const pending = await sql`
      SELECT id, user_id, cost_cents, model, provider, input_tokens, output_tokens, request_id, retries
      FROM pending_deductions
      WHERE status = 'pending' AND retries < ${MAX_DEDUCTION_RETRIES}
      ORDER BY created_at ASC
      LIMIT 50
    `;

    for (const row of pending) {
      try {
        const { deductCredits } = await import("./lib/credits");
        const result = await deductCredits(row.user_id, row.cost_cents, {
          model: row.model,
          provider: row.provider,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
        });
        if (result.success) {
          await sql`UPDATE pending_deductions SET status = 'resolved', resolved_at = now() WHERE id = ${row.id}`;
          log.info("pending_deduction_resolved", { id: row.id, userId: row.user_id, costCents: row.cost_cents });
        } else {
          await sql`UPDATE pending_deductions SET retries = retries + 1 WHERE id = ${row.id}`;
        }
      } catch {
        const newRetries = (row.retries as number) + 1;
        if (newRetries >= MAX_DEDUCTION_RETRIES) {
          await sql`UPDATE pending_deductions SET status = 'failed', retries = ${newRetries} WHERE id = ${row.id}`;
          log.warn("pending_deduction_failed_permanently", { id: row.id, userId: row.user_id });
        } else {
          await sql`UPDATE pending_deductions SET retries = ${newRetries} WHERE id = ${row.id}`;
        }
      }
    }

    // L14: Clean up processed webhook events older than 30 days
    await sql`
      DELETE FROM webhook_events WHERE status = 'processed' AND created_at < now() - interval '30 days'
    `.catch((err) => {
      log.warn("webhook_cleanup_failed", { error: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    log.error("pending_deductions_worker_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

retryTimer = setInterval(processPendingDeductions, RETRY_INTERVAL_MS);
// Run once on startup after a short delay
setTimeout(processPendingDeductions, 10_000);

// ── Marketplace settlement worker (every hour) ────────────────────────────
const SETTLEMENT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let settlementTimer: ReturnType<typeof setInterval> | null = null;

async function processSettlements() {
  try {
    const { settleOwnerEarnings } = await import("./lib/settlement");
    const count = await settleOwnerEarnings();
    if (count > 0) {
      log.info("marketplace_settlements_processed", { count });
    }
  } catch (err) {
    log.error("marketplace_settlement_worker_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

settlementTimer = setInterval(processSettlements, SETTLEMENT_INTERVAL_MS);
// First settlement run after 30 seconds
setTimeout(processSettlements, 30_000);

// ── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutdown_initiated", { signal });

  // Stop workers
  if (retryTimer) clearInterval(retryTimer);
  if (settlementTimer) clearInterval(settlementTimer);

  // Stop alert timers
  try {
    const { stopAlerts } = await import("./lib/alerts");
    stopAlerts();
  } catch {}

  // Allow in-flight requests 10s to complete
  await new Promise((r) => setTimeout(r, 10_000));

  // Close Redis connection
  await closeRedis();

  // Close DB connection pool
  try {
    await sql.end({ timeout: 5 });
    log.info("db_connections_closed");
  } catch (err) {
    log.error("db_close_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Flush Sentry events
  try {
    await Sentry.flush(2000);
  } catch {
    // Ignore flush errors
  }

  log.info("shutdown_complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// H2: Catch unhandled promise rejections (fire-and-forget async tasks)
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log.error("unhandled_rejection", { error: msg, stack });
  Sentry.captureException(reason);
});

const port = Number(process.env.PORT ?? 3001);
log.info("gateway_listening", { port });

export default { port, fetch: app.fetch };
