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
    // Auth limit: 5 requests per minute per IP
    for (let i = 0; i < 5; i++) {
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
    for (let i = 0; i < 5; i++) {
      now += 1;
      await app.request("/auth/login", {
        headers: { "X-Forwarded-For": "test-ip-auth-2" },
      });
    }
    // 6th request should be rejected
    now += 1;
    const res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-2" },
    });
    expect(res.status).toBe(429);
  });

  test("429 response has correct format", async () => {
    const app = createAuthApp();
    for (let i = 0; i < 5; i++) {
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
    for (let i = 0; i < 5; i++) {
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
    expect(parseInt(remaining!)).toBe(4); // 5 max - 1 used = 4
  });

  test("different IPs have separate limits", async () => {
    const app = createAuthApp();
    // Exhaust limit for IP A
    for (let i = 0; i < 5; i++) {
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
    for (let i = 0; i < 5; i++) {
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

    // Advance past 1-minute window
    now += 60_000 + 1;
    res = await app.request("/auth/login", {
      headers: { "X-Forwarded-For": "test-ip-auth-reset" },
    });
    expect(res.status).toBe(200);
  });
});

// ── API rate limiter (by userId + plan) ─────────────────────────────────────

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

  function createApiApp(plan?: string) {
    const app = new Hono();
    // Simulate auth by setting userId and plan
    app.use("*", async (c, next) => {
      const userId = c.req.header("X-Test-UserId");
      if (userId) (c as any).set("userId", userId);
      if (plan) (c as any).set("userPlan", plan);
      await next();
    });
    app.use("*", rateLimitApi as any);
    app.get("/v1/chat/completions", (c) => c.json({ ok: true }));
    return app;
  }

  test("starter: allows up to 50 requests, blocks 51st", async () => {
    const app = createApiApp("starter");
    for (let i = 0; i < 50; i++) {
      now += 1;
      const res = await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-starter-limit" },
      });
      expect(res.status).toBe(200);
    }
    now += 1;
    const res = await app.request("/v1/chat/completions", {
      headers: { "X-Test-UserId": "user-starter-limit" },
    });
    expect(res.status).toBe(429);
  });

  test("pro: allows up to 500 requests, blocks 501st", async () => {
    const app = createApiApp("pro");
    for (let i = 0; i < 500; i++) {
      now += 1;
      await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-pro-limit" },
      });
    }
    now += 1;
    const res = await app.request("/v1/chat/completions", {
      headers: { "X-Test-UserId": "user-pro-limit" },
    });
    expect(res.status).toBe(429);
  });

  test("max: spot-check 100 requests allowed", async () => {
    const app = createApiApp("max");
    for (let i = 0; i < 100; i++) {
      now += 1;
      const res = await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-max-ok" },
      });
      expect(res.status).toBe(200);
    }
  });

  test("unknown plan falls back to starter limits", async () => {
    const app = createApiApp("enterprise");
    for (let i = 0; i < 50; i++) {
      now += 1;
      await app.request("/v1/chat/completions", {
        headers: { "X-Test-UserId": "user-unknown-plan" },
      });
    }
    now += 1;
    const res = await app.request("/v1/chat/completions", {
      headers: { "X-Test-UserId": "user-unknown-plan" },
    });
    expect(res.status).toBe(429);
  });

  test("returns X-RateLimit-Plan header", async () => {
    const app = createApiApp("pro");
    now += 1;
    const res = await app.request("/v1/chat/completions", {
      headers: { "X-Test-UserId": "user-header-check" },
    });
    expect(res.headers.get("X-RateLimit-Plan")).toBe("pro");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("500");
  });

  test("skips rate limit if no userId", async () => {
    const app = createApiApp();
    // No userId header — should pass through
    const res = await app.request("/v1/chat/completions");
    expect(res.status).toBe(200);
  });
});
