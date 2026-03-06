// ---------------------------------------------------------------------------
// Tests for rate-limit middleware
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, spyOn, afterEach } from "bun:test";
import { Hono } from "hono";
import { rateLimitAuth, rateLimitApi } from "./rate-limit";

// ── Auth rate limiter (by IP) ───────────────────────────────────────────────

describe("rateLimitAuth", () => {
  let now: number;
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    now = 1000000;
    spy = spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  function createAuthApp() {
    const app = new Hono();
    app.use("*", rateLimitAuth);
    app.get("/auth/login", (c) => c.json({ ok: true }));
    return app;
  }

  test("allows requests within limit", async () => {
    const app = createAuthApp();
    // Auth limit: 10 requests per 15 minutes per IP
    for (let i = 0; i < 10; i++) {
      now += 1; // small time increment
      const res = await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-1" },
      });
      expect(res.status).toBe(200);
    }
  });

  test("returns 429 when limit exceeded", async () => {
    const app = createAuthApp();
    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-2" },
      });
    }
    // 11th request should be rejected
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-2" },
    });
    expect(res.status).toBe(429);
  });

  test("429 response has correct format", async () => {
    const app = createAuthApp();
    for (let i = 0; i < 10; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-3" },
      });
    }
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-3" },
    });

    const body = await res.json();
    expect(body.error.type).toBe("rate_limit_error");
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
  });

  test("429 response includes Retry-After header", async () => {
    const app = createAuthApp();
    for (let i = 0; i < 10; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-4" },
      });
    }
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-4" },
    });
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(parseInt(retryAfter!)).toBeGreaterThan(0);
  });

  test("includes X-RateLimit-Remaining header", async () => {
    const app = createAuthApp();
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-5" },
    });
    const remaining = res.headers.get("X-RateLimit-Remaining");
    expect(remaining).toBeTruthy();
    expect(parseInt(remaining!)).toBe(9); // 10 max - 1 used = 9
  });

  test("different IPs have separate limits", async () => {
    const app = createAuthApp();
    // Exhaust limit for IP A
    for (let i = 0; i < 10; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "ip-a-separate" },
      });
    }
    // IP B should still be allowed
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "ip-b-separate" },
    });
    expect(res.status).toBe(200);
  });

  test("window resets after windowMs", async () => {
    const app = createAuthApp();
    // Exhaust limit
    for (let i = 0; i < 10; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-reset" },
      });
    }
    now += 1;
    let res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-reset" },
    });
    expect(res.status).toBe(429);

    // Advance past 15-minute window
    now += 15 * 60_000 + 1;
    res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-reset" },
    });
    expect(res.status).toBe(200);
  });
});

// ── API rate limiter (by userId) ────────────────────────────────────────────

describe("rateLimitApi", () => {
  let now: number;
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    now = 2000000;
    spy = spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    spy.mockRestore();
  });

  function createApiApp() {
    const app = new Hono();
    // Simulate auth by setting userId
    app.use("*", async (c, next) => {
      (c as any).set("userId", c.req.header("X-Test-UserId") ?? undefined);
      await next();
    });
    app.use("*", rateLimitApi as any);
    app.get("/v1/chat/completions", (c) => c.json({ ok: true }));
    return app;
  }

  test("allows requests within limit", async () => {
    const app = createApiApp();
    for (let i = 0; i < 60; i++) {
      now += 1;
      const res = await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-api-1" },
      });
      expect(res.status).toBe(200);
    }
  });

  test("returns 429 when limit exceeded", async () => {
    const app = createApiApp();
    for (let i = 0; i < 60; i++) {
      now += 1;
      await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-api-2" },
      });
    }
    now += 1;
    const res = await app.request("/v1/chat/completions", {
      headers: { "X-Test-UserId": "user-api-2" },
    });
    expect(res.status).toBe(429);
  });

  test("skips rate limit if no userId", async () => {
    const app = createApiApp();
    // No userId header — should pass through
    const res = await app.request("/v1/chat/completions");
    expect(res.status).toBe(200);
  });
});
