// ---------------------------------------------------------------------------
// Redis client — connection management for distributed rate limiting
// ---------------------------------------------------------------------------

import Redis from "ioredis";
import { log } from "./logger";

let redis: Redis | null = null;

/** Get the current Redis client (null if not configured or failed) */
export function getRedis(): Redis | null {
  return redis;
}

/** Initialize Redis connection (no-op if REDIS_URL not set) */
export async function initRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    log.info("redis_disabled", {
      message: "REDIS_URL not set, using in-memory rate limiting",
    });
    return;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
      enableReadyCheck: true,
    });

    await redis.connect();
    log.info("redis_connected");
  } catch (err) {
    log.warn("redis_connect_failed", {
      error: err instanceof Error ? err.message : String(err),
      fallback: "in-memory",
    });
    redis = null;
  }
}

/** Lightweight Redis connectivity check for /health endpoint */
export async function checkRedisHealth(): Promise<boolean | null> {
  if (!redis) return null; // null = not configured
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

/** Gracefully close Redis connection */
export async function closeRedis(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
      log.info("redis_disconnected");
    } catch {
      // Ignore close errors
    }
    redis = null;
  }
}
