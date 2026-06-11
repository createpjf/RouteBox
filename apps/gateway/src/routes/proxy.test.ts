import { describe, test, expect, beforeAll, afterAll } from "bun:test";
// env vars set in test-preload.ts
let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  // Self-contained auth: verifyToken reads ROUTEBOX_TOKEN at call time, so a
  // sibling test file (e.g. auth.test.ts) cannot leave a stale token behind.
  process.env.ROUTEBOX_TOKEN = "test-token";
  mockServer = Bun.serve({
    port: 19999,
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/chat/completions") {
        // Echo received auth headers for verification
        const authEcho = req.headers.get("authorization") || "";
        const litellmEcho = req.headers.get("x-litellm-api-key") || "";
        return req.json().then((body: any) => {
          // Deterministic failure injection (M4 test): only triggered when a
          // request carries the sentinel marker in its first message, so other
          // tests using the same models are unaffected. The mock returns a
          // per-model HTTP status read from the marker's status map.
          const firstContent = typeof body.messages?.[0]?.content === "string"
            ? body.messages[0].content
            : "";
          const failMatch = firstContent.match(/__M4_FAIL__:(\{.*\})/);
          if (failMatch) {
            const statusMap = JSON.parse(failMatch[1]) as Record<string, number>;
            const forced = statusMap[body.model];
            if (forced) {
              return Response.json(
                { error: { message: `mock forced ${forced} for ${body.model}` } },
                { status: forced },
              );
            }
          }

          if (body.stream) {
            // Streaming response
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                const chunk1 = { id: "chatcmpl-stream", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] };
                const chunk2 = { id: "chatcmpl-stream", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] };
                const chunk3 = { id: "chatcmpl-stream", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk1)}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk2)}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk3)}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream" },
            });
          }

          // Tool call response
          if (body.tools?.length > 0) {
            return Response.json({
              id: "chatcmpl-tools",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: body.model,
              choices: [{
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"loc":"SF"}' } }],
                },
                finish_reason: "tool_calls",
              }],
              usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
            });
          }

          // Regular response — echo auth headers for tests to verify
          return Response.json({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{
              index: 0,
              message: { role: "assistant", content: "Hello from mock!" },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            _auth: authEcho,
            _litellm: litellmEcho,
          });
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer.stop(true);
});

// Import gateway app after env setup
const { default: gateway } = await import("../index");

async function proxyRequest(body: object, headers: Record<string, string> = {}) {
  return gateway.fetch(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer test-token",
      ...headers,
    },
    body: JSON.stringify(body),
  }));
}

describe("POST /v1/chat/completions", () => {
  test("non-streaming: returns OpenAI-compatible response", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.id).toBe("chatcmpl-test");
    expect(json.choices[0].message.content).toBe("Hello from mock!");
    expect(json.usage.total_tokens).toBe(15);
  });

  test("adds X-RouteBox headers", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(res.headers.get("X-RouteBox-Provider")).toBe("OpenAI");
    expect(res.headers.get("X-RouteBox-Model")).toBe("gpt-4o");
  });

  test("forwards X-Request-ID", async () => {
    const res = await proxyRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      { "X-Request-ID": "my-req-id" },
    );
    expect(res.headers.get("X-Request-ID")).toBe("my-req-id");
  });

  test("generates X-Request-ID when not provided", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    const id = res.headers.get("X-Request-ID");
    expect(id).toBeTruthy();
    expect(id!.length).toBeGreaterThan(8);
  });

  test("tool calling passthrough", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Weather?" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
    });
    const json = await res.json() as any;
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
  });

  test("streaming: returns SSE with [DONE]", async () => {
    const res = await proxyRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
    // Should contain "Hello" and " world" somewhere in the chunks
    expect(text).toContain("Hello");
    expect(text).toContain("world");
  });

  test("401 without auth", async () => {
    const res = await gateway.fetch(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] }),
    }));
    expect(res.status).toBe(401);
  });

  test("503 when traffic is paused", async () => {
    const { metrics } = await import("../lib/metrics");
    metrics.setTrafficPaused(true);
    try {
      const res = await proxyRequest({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.error.code).toBe("traffic_paused");
    } finally {
      metrics.setTrafficPaused(false);
    }
  });

  test("unknown model falls back via wildcard routing", async () => {
    const res = await proxyRequest({
      model: "llama-3-70b",
      messages: [{ role: "user", content: "Hello" }],
    });
    // Wildcard routing finds a fallback model
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json._routebox.is_fallback).toBe(true);
  });

  test("routes qwen models to FLock.io with custom auth header", async () => {
    const res = await proxyRequest({
      model: "qwen3-30b-a3b-instruct-2507",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RouteBox-Provider")).toBe("FLock.io");
    const json = await res.json() as any;
    // FLock.io uses x-litellm-api-key instead of Authorization Bearer
    expect(json._litellm).toBe("test-flock");
    expect(json._auth).toBe("");
  });

  test("M4: primary 5xx → fallback 4xx returns upstream error, NOT 200", async () => {
    const { metrics } = await import("../lib/metrics");

    // Arrange: prime OpenAI to failStreak=2 (still UP, threshold is 3) so the
    // top-level route picks OpenAI (isFallback:false). The handler's single
    // markProviderDown inside the 5xx branch then trips OpenAI to DOWN, so the
    // in-branch selectRoute("gpt-4o","quality_first") falls back to FLock.io
    // (kimi-k2-thinking) — a DIFFERENT provider — and retries it.
    metrics.markProviderDown("OpenAI");
    metrics.markProviderDown("OpenAI");

    try {
      // Mock: gpt-4o (primary, OpenAI) → 503; kimi-k2-thinking (retry, FLock) → 400.
      const marker = `__M4_FAIL__:${JSON.stringify({ "gpt-4o": 503, "kimi-k2-thinking": 400 })}`;
      const res = await proxyRequest({
        model: "gpt-4o",
        messages: [{ role: "user", content: marker }],
      });

      // The fallback returned 4xx (not 2xx), so it must NOT be treated as a
      // success. Pre-fix (retryRes.ok || retryRes.status < 500) returned the
      // 400 body as a 200. Post-fix the error branch returns 502.
      expect(res.status).toBe(502);
      expect(res.status).not.toBe(200);
      const json = await res.json() as any;
      expect(json.error?.type).toBe("upstream_error");
    } finally {
      // Restore shared singleton state: reset both providers to healthy so
      // sibling tests (and other test files) see them UP.
      const reset = (provider: string, model: string) =>
        metrics.record({
          id: crypto.randomUUID(), timestamp: Date.now(), provider, model, inputTokens: 0, outputTokens: 0,
          totalTokens: 0, cost: 0, latencyMs: 1, status: "success",
        });
      reset("OpenAI", "gpt-4o");
      reset("FLock.io", "kimi-k2-thinking");
    }
  });

  test("H1: network-error cross-provider fallback records the provider that actually served it", async () => {
    const { providers } = await import("../lib/providers");
    const { metrics } = await import("../lib/metrics");
    const anthropic = providers.find((p) => p.name === "Anthropic");
    if (!anthropic) return; // env didn't configure Anthropic — skip
    const originalBaseUrl = anthropic.baseUrl;
    anthropic.baseUrl = "http://127.0.0.1:1/v1"; // dead port → fetch throws
    // Prime Anthropic to failStreak=2 (still up); the handler's single in-catch
    // markProviderDown then trips it to 3=down, forcing a cross-provider fallback.
    metrics.markProviderDown("Anthropic");
    metrics.markProviderDown("Anthropic");
    try {
      const res = await proxyRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(res.status).toBe(200);
      const served = res.headers.get("X-RouteBox-Provider");
      expect(served).not.toBe("Anthropic");
      const json = await res.json() as any;
      expect(json.choices[0].message.content).toBe("Hello from mock!");
      expect(json._routebox.provider).toBe(served!.toLowerCase());
      expect(json._routebox.is_fallback).toBe(true);
    } finally {
      anthropic.baseUrl = originalBaseUrl;
      // Restore shared singleton state: reset Anthropic (primed down) and the
      // served fallback provider to healthy using the same success-recording
      // mechanism the M4 test uses, so sibling tests see all providers UP.
      const reset = (provider: string, model: string) =>
        metrics.record({
          id: crypto.randomUUID(), timestamp: Date.now(), provider, model, inputTokens: 0, outputTokens: 0,
          totalTokens: 0, cost: 0, latencyMs: 1, status: "success",
        });
      reset("Anthropic", "claude-sonnet-4-20250514");
      reset("OpenAI", "gpt-4o");
      reset("FLock.io", "kimi-k2-thinking");
    }
  });
});

describe("GET /health", () => {
  test("returns ok without auth", async () => {
    const res = await gateway.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe("ok");
    expect(json.providers).toContain("OpenAI");
    expect(json.providers).toContain("FLock.io");
  });
});
