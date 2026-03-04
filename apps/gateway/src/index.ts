import { Hono } from "hono";
import { cors } from "hono/cors";
import stats, { websocket } from "./routes/stats";
import api from "./routes/api";
import proxy from "./routes/proxy";
import { authMiddleware } from "./lib/auth";
import { providers, rebuildProviders } from "./lib/providers";
import { loadAllProviderKeys } from "./lib/db";
import { metrics } from "./lib/metrics";
import { initLocalProviders, probeAllLocalProviders, startLocalProviderPolling, localProviders } from "./lib/local-providers";

// ── Load DB keys on startup ─────────────────────────────────────────────────
const dbKeys = new Map<string, string>();
for (const row of loadAllProviderKeys()) {
  dbKeys.set(row.provider_name, row.api_key);
}
if (dbKeys.size > 0) {
  rebuildProviders(dbKeys);
  metrics.syncProviders();
}

// ── Local provider discovery (Ollama, LM Studio) ────────────────────────────
initLocalProviders();
probeAllLocalProviders().then(() => {
  const online = localProviders.filter((lp) => lp.isOnline);
  if (online.length > 0) {
    console.log(`   Local: ${online.map((lp) => `${lp.name} (${lp.models.length} models)`).join(", ")}`);
  }
  metrics.syncProviders();
}).catch(() => {});
startLocalProviderPolling();

const app = new Hono();

// CORS — restricted to Tauri webview and local development
function isAllowedOrigin(origin: string): boolean {
  if (origin === "tauri://localhost") return true;
  try {
    const url = new URL(origin);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname === "localhost"
    ) {
      return true;
    }
  } catch {
    // malformed origin
  }
  return false;
}

app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
  }),
);

// Health check (no auth)
app.get("/health", (c) => c.json({
  status: "ok",
  uptime: process.uptime(),
  providers: providers.map((p) => p.name),
  localProviders: localProviders.filter((lp) => lp.isOnline).map((lp) => ({
    name: lp.name,
    models: lp.models.length,
  })),
}));

// Auth for REST + proxy
app.use("/api/v1/*", authMiddleware);
app.use("/v1/*", authMiddleware);

// WebSocket stats (auth checked inside upgrade handler via query param)
app.route("/", stats);

// Control-plane REST API
app.route("/api/v1", api);

// LLM proxy (OpenAI-compatible)
app.route("/v1", proxy);

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`🚀 RouteBox Gateway running on http://localhost:${port}`);
console.log(`   Providers: ${providers.map((p) => p.name).join(", ") || "(none — set API keys)"}`);

// ── Startup latency probe — ping each provider to seed real-time latency ──
async function probeProviderLatency() {
  for (const p of providers) {
    const start = performance.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (p.authHeader) {
        headers[p.authHeader] = p.apiKey;
      } else if (p.format === "anthropic") {
        headers["x-api-key"] = p.apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["Authorization"] = `Bearer ${p.apiKey}`;
      }
      // Use /models endpoint as a lightweight ping
      const url = p.format === "anthropic"
        ? `${p.baseUrl}/messages` // Anthropic has no /models; a tiny HEAD-like POST will 400 but measure latency
        : `${p.baseUrl}/models`;
      await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(5000) });
      const latency = Math.round(performance.now() - start);
      metrics.seedLatency(p.name, latency);
      console.log(`   Probe ${p.name}: ${latency}ms`);
    } catch {
      const latency = Math.round(performance.now() - start);
      // Even on error, the round-trip time is useful as a latency signal
      if (latency < 5000) {
        metrics.seedLatency(p.name, latency);
        console.log(`   Probe ${p.name}: ${latency}ms (error, but latency recorded)`);
      } else {
        console.log(`   Probe ${p.name}: timeout`);
      }
    }
  }
}
probeProviderLatency();

process.on("SIGTERM", () => { console.log("Shutting down..."); process.exit(0); });
process.on("SIGINT", () => { console.log("Shutting down..."); process.exit(0); });

export default {
  port,
  fetch: app.fetch,
  websocket,
};
