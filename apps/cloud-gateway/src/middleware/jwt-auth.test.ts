// ---------------------------------------------------------------------------
// Tests for JWT authentication middleware
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";

// ── Mock dependencies ───────────────────────────────────────────────────────

let mockVerifyResult: { sub: string; email: string } | null = null;
let mockVerifyError: Error | null = null;

mock.module("../lib/jwt", () => ({
  verifyToken: async () => {
    if (mockVerifyError) throw mockVerifyError;
    return mockVerifyResult;
  },
}));

// db-cloud is mocked via test-setup.ts preload — set globalThis for user row queries.

const { jwtAuth } = await import("./jwt-auth");

beforeEach(() => {
  mockVerifyResult = { sub: "user-1", email: "test@example.com" };
  mockVerifyError = null;
  // Default: user found with pro plan
  // @ts-ignore
  globalThis.__dbMockSqlResults = [[{ plan: "pro" }]];
  // @ts-ignore
  globalThis.__dbMockTxResults = [];
  // @ts-ignore
  globalThis.__dbMockSqlCalls = [];
});

function createApp() {
  const app = new Hono();
  app.use("*", jwtAuth as any);
  app.get("/protected", (c) => {
    return c.json({
      userId: (c as any).get("userId"),
      email: (c as any).get("email"),
      userPlan: (c as any).get("userPlan"),
    });
  });
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("jwtAuth", () => {
  test("returns 401 when no Authorization header", async () => {
    const app = createApp();
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("auth_error");
  });

  test("returns 401 for non-Bearer format", async () => {
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  test("returns 401 when token verification fails", async () => {
    mockVerifyError = new Error("Token expired");
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid or expired");
  });

  test("sets userId, email, userPlan on valid token", async () => {
    mockVerifyResult = { sub: "user-42", email: "dev@test.com" };
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ plan: "business" }]];
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-42");
    expect(body.email).toBe("dev@test.com");
    expect(body.userPlan).toBe("business");
  });

  test("defaults to free plan when user not found", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userPlan).toBe("free");
  });
});
