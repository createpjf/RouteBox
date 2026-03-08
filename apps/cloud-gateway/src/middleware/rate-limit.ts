// ---------------------------------------------------------------------------
// Sliding-window rate limiter — Redis (distributed) with in-memory fallback
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import type { CloudEnv } from "../types";
import { log } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { getRedis } from "../lib/redis";

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

interface WindowEntry {
  timestamps: number[];
}

// ---------------------------------------------------------------------------
// In-memory store (fallback when Redis unavailable)
// ---------------------------------------------------------------------------

const stores = new Map<string, Map<string, WindowEntry>>();

/** Periodic cleanup of expired entries (every 5 minutes) */
const CLEANUP_INTERVAL = 5 * 60_000;

function getStore(name: string): Map<string, WindowEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function checkLimitMemory(
  store: Map<string, WindowEntry>,
  key: string,
  config: RateLimitConfig,
  now: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the window
  const windowStart = now - config.windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.max) {
    // Find earliest expiring timestamp
    const oldest = entry.timestamps[0]!;
    const retryAfterMs = oldest + config.windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.max - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

// Cleanup timer
setInterval(() => {
  const now = Date.now();
  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter(
        (t) => now - t < 30 * 60_000, // Keep entries from last 30 min max
      );
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }
}, CLEANUP_INTERVAL);

// ---------------------------------------------------------------------------
// Redis sliding window (Lua script for atomic operation)
// ---------------------------------------------------------------------------

const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local max = tonumber(ARGV[3])
  local windowStart = now - windowMs

  redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
  local count = redis.call('ZCARD', key)

  if count >= max then
    local oldest = redis.call('ZRANGEBYSCORE', key, '-inf', '+inf', 'LIMIT', 0, 1)
    local retryAfter = 0
    if #oldest > 0 then
      retryAfter = tonumber(oldest[1]) + windowMs - now
    end
    return {0, 0, retryAfter}
  end

  redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
  redis.call('PEXPIRE', key, windowMs + 1000)
  return {1, max - count - 1, 0}
`;

// ---------------------------------------------------------------------------
// Unified check with Redis → in-memory fallback
// ---------------------------------------------------------------------------

async function checkLimit(
  limiterName: string,
  key: string,
  config: RateLimitConfig,
  now: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const redis = getRedis();

  if (redis) {
    try {
      const redisKey = `rl:${limiterName}:${key}`;
      const result = (await redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        redisKey,
        now,
        config.windowMs,
        config.max,
      )) as number[];
      return {
        allowed: result[0] === 1,
        remaining: result[1]!,
        retryAfterMs: result[2]!,
      };
    } catch (err) {
      log.warn("redis_rate_limit_fallback", {
        limiter: limiterName,
        error: err instanceof Error ? err.message : String(err),
      });
      // Redis was available but errored — use stricter in-memory limits
      // to compensate for per-instance counting in multi-instance deploys
      const store = getStore(limiterName);
      const fallbackConfig = { ...config, max: Math.max(1, Math.floor(config.max / 2)) };
      return checkLimitMemory(store, key, fallbackConfig, now);
    }
  }

  // No Redis configured — use standard in-memory limits
  const store = getStore(limiterName);
  return checkLimitMemory(store, key, config, now);
}

// ---------------------------------------------------------------------------
// Rate limit configurations
// ---------------------------------------------------------------------------

const LIMITS = {
  auth:           { windowMs: 60_000, max: 5    } as RateLimitConfig, // 5 req/min per IP
  api:            { windowMs: 60_000, max: 1000 } as RateLimitConfig, // default (overridden per plan)
  account:        { windowMs: 60_000, max: 500  } as RateLimitConfig, // 500 req/min per userId
  billing:        { windowMs: 60_000, max: 10   } as RateLimitConfig, // 10 req/min per IP
  forgotPassword: { windowMs: 600_000, max: 5   } as RateLimitConfig, // 5 req/10min per IP
};

/** Per-plan API rate limits */
const API_LIMITS_BY_PLAN: Record<string, RateLimitConfig> = {
  starter: { windowMs: 60_000, max: 50   },
  pro:     { windowMs: 60_000, max: 500  },
  max:     { windowMs: 60_000, max: 2000 },
};

function getClientIP(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function rejectWithLimit(
  c: Context,
  retryAfterMs: number,
): Response {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return c.json(
    {
      error: {
        message: "Too many requests. Please try again later.",
        type: "rate_limit_error",
        retry_after_seconds: retryAfterSec,
      },
    },
    429,
    { "Retry-After": String(retryAfterSec) },
  );
}

// ---------------------------------------------------------------------------
// Exported middleware functions
// ---------------------------------------------------------------------------

/** Rate limit auth routes by client IP */
export async function rateLimitAuth(c: Context, next: Next) {
  const key = getClientIP(c);
  const result = await checkLimit("auth", key, LIMITS.auth, Date.now());

  if (!result.allowed) {
    log.warn("rate_limit_hit", { limiter: "auth", key, retryAfterMs: result.retryAfterMs });
    incCounter("rate_limit_hits_total", { limiter: "auth" });
    return rejectWithLimit(c, result.retryAfterMs);
  }

  c.header("X-RateLimit-Remaining", String(result.remaining));
  await next();
}

/** Rate limit API routes by userId — limit varies by plan */
export async function rateLimitApi(c: Context<CloudEnv>, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId) {
    await next();
    return;
  }

  const userPlan = (c.get("userPlan") as string | undefined) ?? "starter";
  const config = API_LIMITS_BY_PLAN[userPlan] ?? API_LIMITS_BY_PLAN.starter;

  const result = await checkLimit("api", userId, config, Date.now());

  if (!result.allowed) {
    log.warn("rate_limit_hit", { limiter: "api", key: userId, plan: userPlan, retryAfterMs: result.retryAfterMs });
    incCounter("rate_limit_hits_total", { limiter: "api" });
    return rejectWithLimit(c, result.retryAfterMs);
  }

  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Limit", String(config.max));
  c.header("X-RateLimit-Plan", userPlan);
  await next();
}

/** Rate limit account routes by userId */
export async function rateLimitAccount(c: Context<CloudEnv>, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId) {
    await next();
    return;
  }

  const result = await checkLimit("account", userId, LIMITS.account, Date.now());

  if (!result.allowed) {
    log.warn("rate_limit_hit", { limiter: "account", key: userId, retryAfterMs: result.retryAfterMs });
    incCounter("rate_limit_hits_total", { limiter: "account" });
    return rejectWithLimit(c, result.retryAfterMs);
  }

  c.header("X-RateLimit-Remaining", String(result.remaining));
  await next();
}

/** Rate limit forgot-password by client IP (stricter than general auth) */
export async function rateLimitForgotPassword(c: Context, next: Next) {
  const key = getClientIP(c);
  const result = await checkLimit("forgotPassword", key, LIMITS.forgotPassword, Date.now());

  if (!result.allowed) {
    log.warn("rate_limit_hit", { limiter: "forgotPassword", key, retryAfterMs: result.retryAfterMs });
    incCounter("rate_limit_hits_total", { limiter: "forgotPassword" });
    return rejectWithLimit(c, result.retryAfterMs);
  }

  c.header("X-RateLimit-Remaining", String(result.remaining));
  await next();
}

/** Rate limit billing routes by userId (or IP for public endpoints) */
export async function rateLimitBilling(c: Context<CloudEnv>, next: Next) {
  const userId = (c.get("userId") as string | undefined) ?? getClientIP(c);
  const result = await checkLimit("billing", userId, LIMITS.billing, Date.now());

  if (!result.allowed) {
    log.warn("rate_limit_hit", { limiter: "billing", key: userId, retryAfterMs: result.retryAfterMs });
    incCounter("rate_limit_hits_total", { limiter: "billing" });
    return rejectWithLimit(c, result.retryAfterMs);
  }

  c.header("X-RateLimit-Remaining", String(result.remaining));
  await next();
}
