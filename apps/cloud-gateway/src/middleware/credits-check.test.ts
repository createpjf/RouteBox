// ---------------------------------------------------------------------------
// Tests for credits-check middleware
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";

// ── Mock credits module ─────────────────────────────────────────────────────
// db-cloud is already mocked via test-setup.ts preload.
// We mock the credits module directly since we need to control getBalance.

let mockBalance = 0;

mock.module("../lib/credits", () => ({
  getBalance: async () => mockBalance,
  deductCredits: async () => ({ success: true, newBalance: 0 }),
  addCredits: async () => 0,
  recordCloudRequest: async () => {},
  getTransactions: async () => [],
}));

const { creditsCheck } = await import("./credits-check");

function createApp() {
  const app = new Hono();
  // Simulate auth by setting userId from header
  app.use("*", async (c, next) => {
    const userId = c.req.header("X-Test-UserId");
    if (userId) (c as any).set("userId", userId);
    await next();
  });
  app.use("*", creditsCheck as any);
  app.post("/v1/chat/completions", (c) => c.json({ ok: true }));
  return app;
}

describe("creditsCheck", () => {
  test("returns 401 when no userId", async () => {
    const app = createApp();
    const res = await app.request("/v1/chat/completions", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("auth_error");
  });

  test("allows request when balance >= 50 cents", async () => {
    mockBalance = 50;
    const app = createApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "X-Test-UserId": "user-1" },
    });
    expect(res.status).toBe(200);
  });

  test("returns 402 when balance < 50 cents", async () => {
    mockBalance = 49;
    const app = createApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "X-Test-UserId": "user-2" },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("insufficient_credits");
    expect(body.error.balance_cents).toBe(49);
  });

  test("returns 402 when balance is 0", async () => {
    mockBalance = 0;
    const app = createApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "X-Test-UserId": "user-3" },
    });
    expect(res.status).toBe(402);
  });

  test("402 response has correct structure", async () => {
    mockBalance = 10;
    const app = createApp();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "X-Test-UserId": "user-4" },
    });
    const body = await res.json();
    expect(body.error).toHaveProperty("message");
    expect(body.error).toHaveProperty("type");
    expect(body.error.type).toBe("billing_error");
  });
});
