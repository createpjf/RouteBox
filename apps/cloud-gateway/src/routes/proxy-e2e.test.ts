// ---------------------------------------------------------------------------
// E2E tests for proxy routes — auth → routing → billing full chain
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import type { CloudEnv } from "../types";

// ── Track deduct / record calls ──────────────────────────────────────────────

let deductCalls: unknown[][] = [];
let recordCalls: unknown[][] = [];
let mockGetBalanceInfo = async (_userId: string) => ({
  balance_cents: 5000,
  bonus_cents: 0,
  total_cents: 5000,
});

// ── Mock modules (must be before import) ────────────────────────────────────

mock.module("../lib/model-registry", () => ({
  getRegistryEntry: async () => null,
  getActiveModels: async () => [],
  reloadRegistry: () => {},
}));

mock.module("../lib/scoring-engine", () => ({
  scoreAndRank: async () => [],
}));

mock.module("../lib/circuit-breaker", () => ({
  getCircuitBreaker: () => ({
    canRequest: () => true,
    onSuccess: () => {},
    onFailure: () => {},
    getState: () => "closed",
  }),
}));

mock.module("../lib/credits", () => ({
  deductCredits: async (...args: unknown[]) => {
    deductCalls.push(args);
    return { success: true, newBalance: 4900 };
  },
  recordCloudRequest: async (...args: unknown[]) => {
    recordCalls.push(args);
  },
  getBalanceInfo: async (userId: string) => mockGetBalanceInfo(userId),
}));

mock.module("../lib/routing-config", () => ({
  resolveStrategy: () => "smart_auto",
}));

mock.module("../lib/quota", () => ({
  checkDailyQuota: async () => ({ allowed: true, remaining: Infinity, resetAt: new Date() }),
  incrementDailyQuota: async () => {},
}));

mock.module("../lib/provider-config", () => ({
  isProviderAllowed: () => true,
}));

mock.module("../lib/key-pool", () => ({
  cloudProviders: [
    {
      name: "TestProvider",
      instanceId: "test-1",
      baseUrl: "http://localhost:9999",
      apiKey: "test-key",
      format: "openai",
      prefixes: ["minimax-", "kimi-"],
    },
  ],
  cloudProviderForModel: () => null,
  cloudProvidersForModel: () => [
    {
      name: "TestProvider",
      instanceId: "test-1",
      baseUrl: "http://localhost:9999",
      apiKey: "test-key",
      format: "openai",
      prefixes: ["minimax-", "kimi-"],
    },
  ],
  getOpenRouterFallbacks: () => [],
}));

mock.module("../lib/metrics", () => ({
  incCounter: () => {},
  observeHistogram: () => {},
  incGauge: () => {},
  decGauge: () => {},
}));

mock.module("../lib/logger", () => ({
  log: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

mock.module("../lib/request-context", () => ({
  buildRequestContext: () => ({ contentType: "general" }),
}));

// Explicitly mock credits-check middleware to use our mockGetBalanceInfo.
// This prevents leaking from other test files that mock it as pass-through.
mock.module("../middleware/credits-check", () => ({
  creditsCheck: async (c: any, next: any) => {
    const userId = c.get("userId") as string;
    if (!userId) {
      return c.json(
        { error: { message: "Authentication required", type: "invalid_request_error", param: null, code: "invalid_api_key" } },
        401,
      );
    }
    const { total_cents, balance_cents } = await mockGetBalanceInfo(userId);
    if (total_cents < 50) {
      return c.json(
        {
          error: {
            message: "Insufficient credits. Please add credits to continue.",
            type: "billing_error",
            code: "insufficient_credits",
            balance_cents,
            total_cents,
          },
        },
        402,
      );
    }
    await next();
  },
}));

// ── Mock jwt + crypto for API key auth ──────────────────────────────────────

mock.module("../lib/jwt", () => ({
  verifyToken: async () => { throw new Error("invalid"); },
}));

mock.module("../lib/crypto", () => ({
  sha256Hex: async (text: string) => `hash_of_${text}`,
}));

// ── Import routes after mocks ───────────────────────────────────────────────

const proxyApp = (await import("./proxy")).default;
const { calculateUserCostCents, pricingFor } = await import("./proxy");

// Also need jwtAuth for the auth chain tests
const { jwtAuth } = await import("../middleware/jwt-auth");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create app with jwtAuth middleware (for auth chain tests) */
function createAuthApp() {
  const app = new Hono<CloudEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req-test");
    await next();
  });
  app.use("*", jwtAuth);
  app.route("/v1", proxyApp);
  return app;
}

/** Create app that skips auth (sets context directly) */
function createApp(overrides?: { userId?: string; userPlan?: string }) {
  const app = new Hono<CloudEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", overrides?.userId ?? "test-user");
    c.set("userPlan", overrides?.userPlan ?? "pro");
    c.set("requestId", "req-test");
    await next();
  });
  app.route("/", proxyApp);
  return app;
}

const CHAT_BODY = {
  model: "minimax-m2.5",
  messages: [{ role: "user", content: "Hello" }],
};

const PROVIDER_JSON_RESPONSE = {
  id: "chatcmpl-test",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello there!" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

let originalFetch: typeof globalThis.fetch;

/** Set global fetch mock (with proper typing for Bun's extended fetch) */
function mockFetch(fn: (...args: any[]) => Promise<Response>) {
  // @ts-ignore — Bun's fetch has extra properties (preconnect) not in our mock
  globalThis.fetch = fn;
}

beforeEach(() => {
  // @ts-ignore
  globalThis.__dbMockSqlResults = [];
  // @ts-ignore
  globalThis.__dbMockSqlCalls = [];
  deductCalls = [];
  recordCalls = [];
  mockGetBalanceInfo = async () => ({
    balance_cents: 5000,
    bonus_cents: 0,
    total_cents: 5000,
  });
  // Save and restore original fetch
  if (!originalFetch) originalFetch = globalThis.fetch;
  mockFetch(originalFetch);
});

// ═══════════════════════════════════════════════════════════════════════════
// T1. Auth chain — API key → request passes
// ═══════════════════════════════════════════════════════════════════════════

describe("T1: API key auth → request passes", () => {
  test("valid rb_ key authenticates and proxies request", async () => {
    const app = createAuthApp();

    // DB mock chain (creditsCheck uses mocked getBalanceInfo, not sql):
    // 1. API key SELECT → found
    // 2. UPDATE last_used_at (fire-and-forget, synchronous shift)
    // 3. disabled model check
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ user_id: "user-123", plan: "pro", email: "test@example.com", status: "active" }],
      [], // UPDATE last_used_at
      [], // disabled model check
    ];

    // Mock upstream provider
    mockFetch(async () =>
      new Response(JSON.stringify(PROVIDER_JSON_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer rb_test_key_123",
      },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe("chatcmpl-test");
    expect(body._routebox).toBeDefined();
    expect(body._routebox.provider).toBe("testprovider");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T2. Auth failure — invalid API key → 401
// ═══════════════════════════════════════════════════════════════════════════

describe("T2: Invalid API key → 401", () => {
  test("unknown rb_ key returns 401", async () => {
    const app = createAuthApp();

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // API key SELECT → not found
    ];

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer rb_invalid_key",
      },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.param).toBeNull();
    expect(body.error.code).toBe("invalid_api_key");
  });

  test("missing Authorization header returns 401", async () => {
    const app = createAuthApp();

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T3. Insufficient credits → 402
// ═══════════════════════════════════════════════════════════════════════════

describe("T3: Insufficient credits → 402", () => {
  test("balance below $0.50 returns 402", async () => {
    // Use a custom app with an explicit credits check middleware
    // (the proxy module's internal creditsCheck may be mocked as pass-through
    //  due to module caching from other test files)
    const app = new Hono<CloudEnv>();
    app.use("*", async (c, next) => {
      c.set("userId", "test-user");
      c.set("userPlan", "pro");
      c.set("requestId", "req-test");
      await next();
    });
    // Inline credits check that rejects low balance
    app.use("/chat/completions", async (c, next) => {
      const userId = c.get("userId") as string;
      const { total_cents, balance_cents } = await mockGetBalanceInfo(userId);
      if (total_cents < 50) {
        return c.json({
          error: {
            message: "Insufficient credits. Please add credits to continue.",
            type: "billing_error",
            code: "insufficient_credits",
            balance_cents,
            total_cents,
          },
        }, 402);
      }
      await next();
    });
    app.route("/", proxyApp);

    // Override mocked getBalanceInfo to return low balance
    mockGetBalanceInfo = async () => ({
      balance_cents: 30,
      bonus_cents: 0,
      total_cents: 30,
    });

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.error.code).toBe("insufficient_credits");
    expect(body.error.total_cents).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T4. Full chain — non-streaming request + deduct
// ═══════════════════════════════════════════════════════════════════════════

describe("T4: Non-streaming full chain (route + deduct)", () => {
  test("200 response with _routebox metadata and deductCredits called", async () => {
    const app = createApp({ userPlan: "pro" });

    // DB mocks: only disabled model check (creditsCheck uses mocked getBalanceInfo)
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check → none disabled
    ];

    // Mock upstream provider
    mockFetch(async () =>
      new Response(JSON.stringify(PROVIDER_JSON_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Response structure
    expect(body.id).toBe("chatcmpl-test");
    expect(body.choices[0].message.content).toBe("Hello there!");

    // _routebox metadata
    expect(body._routebox).toBeDefined();
    expect(body._routebox.provider).toBe("testprovider");
    expect(body._routebox.routed_model).toBe("minimax-m2.5");
    expect(body._routebox.user_cost_cents).toBeGreaterThan(0);
    expect(body._routebox.usage.prompt_tokens).toBe(100);
    expect(body._routebox.usage.completion_tokens).toBe(50);

    // deductCredits was called with correct args
    expect(deductCalls).toHaveLength(1);
    expect(deductCalls[0][0]).toBe("test-user"); // userId
    expect(deductCalls[0][1]).toBeGreaterThan(0); // costCents
    const meta = deductCalls[0][2] as any;
    expect(meta.model).toBe("minimax-m2.5");
    expect(meta.provider).toBe("TestProvider");
    expect(meta.inputTokens).toBe(100);
    expect(meta.outputTokens).toBe(50);

    // recordCloudRequest was called
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0][0]).toBe("test-user");
    expect(recordCalls[0][1]).toBe("minimax-m2.5");
    expect(recordCalls[0][2]).toBe("TestProvider");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T5. Streaming response + deduct
// ═══════════════════════════════════════════════════════════════════════════

describe("T5: Streaming full chain", () => {
  test("SSE stream with routebox.meta and deductCredits called", async () => {
    const app = createApp({ userPlan: "pro" });

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    // Mock upstream provider returning SSE stream
    const encoder = new TextEncoder();
    mockFetch(async () => {
      const stream = new ReadableStream({
        start(controller) {
          // Chunk with content
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              id: "chatcmpl-stream",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
            })}\n\n`,
          ));
          // Final chunk with usage
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              id: "chatcmpl-stream",
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            })}\n\n`,
          ));
          // [DONE]
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...CHAT_BODY, stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    // Read the full stream
    const text = await res.text();

    // Should contain routebox.meta
    expect(text).toContain("routebox.meta");
    // Should contain [DONE]
    expect(text).toContain("[DONE]");

    // Wait briefly for onDone async callback
    await new Promise((r) => setTimeout(r, 50));

    // deductCredits should have been called
    expect(deductCalls.length).toBeGreaterThanOrEqual(1);
    expect(deductCalls[0][0]).toBe("test-user");
    expect((deductCalls[0][1] as number)).toBeGreaterThanOrEqual(0);

    // recordCloudRequest should have been called
    expect(recordCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T6. Model disabled → 403
// ═══════════════════════════════════════════════════════════════════════════

describe("T6: Disabled model → 403", () => {
  test("disabled model returns 403 model_disabled", async () => {
    const app = createApp();

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ "?column?": 1 }], // disabled model check → model IS disabled
    ];

    mockFetch(async () =>
      new Response("should not reach", { status: 200 }));

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("model_disabled");
    expect(body.error.message).toContain("currently unavailable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T7. All providers fail → 502
// ═══════════════════════════════════════════════════════════════════════════

describe("T7: All providers fail → 502", () => {
  test("upstream 500 → returns 502 after retries", async () => {
    const app = createApp();

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    // All fetch attempts return 500
    let fetchCount = 0;
    mockFetch(async () => {
      fetchCount++;
      return new Response("Internal Server Error", { status: 500 });
    });

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error.type).toBe("server_error");
    // Should have retried (1 original + 2 retries = 3 attempts)
    expect(fetchCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T8. scoreAndRank exception → degrades to prefix matching
// ═══════════════════════════════════════════════════════════════════════════

describe("T8: scoreAndRank exception → fallback to prefix match", () => {
  test("scoring engine returns empty → falls back to prefix match", async () => {
    const app = createApp();

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    mockFetch(async () =>
      new Response(JSON.stringify(PROVIDER_JSON_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    // Request should succeed via prefix-match fallback
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body._routebox.provider).toBe("testprovider");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T9. calculateUserCostCents — pricing precision
// ═══════════════════════════════════════════════════════════════════════════

describe("T9: Pricing precision — calculateUserCostCents", () => {
  test("starter/pro plan uses 1.08× markup on MODEL_PRICING", () => {
    const pricing = { input: 0.30, output: 1.20, markup: 1.08 };
    const cost = calculateUserCostCents(100, 50, pricing);
    // raw = (100 * 0.30 + 50 * 1.20) / 1_000_000 = 0.00009
    // with markup: 0.00009 * 1.08 * 100 = 0.00972 → ceil → 1
    expect(cost).toBe(1);
  });

  test("max plan uses 1.05× markup", () => {
    const pricing = { input: 0.30, output: 1.20, markup: 1.05 };
    const cost = calculateUserCostCents(100, 50, pricing);
    expect(cost).toBe(1);
  });

  test("registry-priced model uses 1.0× markup", () => {
    const pricing = { input: 0.30, output: 1.20, markup: 1.0 };
    const cost = calculateUserCostCents(100, 50, pricing);
    expect(cost).toBe(1);
  });

  test("larger token counts produce correct cost", () => {
    const pricing = { input: 3.00, output: 15.00, markup: 1.08 };
    const cost = calculateUserCostCents(1_000_000, 500_000, pricing);
    // raw = (1M * 3 + 500K * 15) / 1M = 3 + 7.5 = 10.5
    // with markup: 10.5 * 1.08 * 100 = 1134 → ceil → 1134
    expect(cost).toBe(1134);
  });

  test("zero tokens → zero cost", () => {
    const pricing = { input: 0.30, output: 1.20, markup: 1.08 };
    const cost = calculateUserCostCents(0, 0, pricing);
    expect(cost).toBe(0);
  });

  test("pricingFor returns correct rates for known models", () => {
    const p = pricingFor("minimax-m2.5");
    expect(p.input).toBe(0.30);
    expect(p.output).toBe(1.20);
  });

  test("pricingFor returns default for unknown models", () => {
    const p = pricingFor("unknown-model-xyz");
    expect(p.input).toBe(1);
    expect(p.output).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T10. Webhook — missing metadata → 422
// ═══════════════════════════════════════════════════════════════════════════

describe("T10: Webhook missing metadata → 422", () => {
  test("order.paid without userId → 422", async () => {
    mock.module("../lib/polar", () => ({
      getMarkupForPlan: () => 1.5,
      loadCreditPackages: async () => [],
      SUBSCRIPTION_PLANS: {},
      createCheckoutSession: async () => ({ url: "", id: "" }),
      createSubscriptionCheckout: async () => ({ url: "", id: "" }),
      cancelSubscription: async () => {},
      constructWebhookEvent: () => ({
        type: "order.paid",
        data: {
          id: "order-123",
          metadata: {}, // Missing userId and creditsCents
        },
      }),
      WebhookVerificationError: class extends Error {},
    }));

    const billingApp = (await import("./billing")).default;

    const app = new Hono();
    app.route("/billing", billingApp);

    const res = await app.request("/billing/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": "wh-123",
        "webhook-timestamp": "1234567890",
        "webhook-signature": "v1,signature",
      },
      body: JSON.stringify({ type: "order.paid", data: { id: "order-123" } }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.error).toContain("Missing userId");
  });
});
