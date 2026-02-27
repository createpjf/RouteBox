import { describe, test, expect, beforeAll, afterAll } from "bun:test";
// env vars set in test-preload.ts
let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 19999,
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/chat/completions") {
        // Echo received auth headers for verification
        const authEcho = req.headers.get("authorization") || "";
        const litellmEcho = req.headers.get("x-litellm-api-key") || "";
        return req.json().then((body: any) => {
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
    expect(id!.startsWith("rb-")).toBe(true);
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

  test("503 for unknown model with no provider", async () => {
    const res = await proxyRequest({
      model: "llama-3-70b",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(res.status).toBe(503);
    const json = await res.json() as any;
    expect(json.error.code).toBe("no_provider");
  });

  test("routes qwen models to Flock with custom auth header", async () => {
    const res = await proxyRequest({
      model: "qwen3-30b-a3b-instruct-2507",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RouteBox-Provider")).toBe("Flock");
    const json = await res.json() as any;
    // Flock uses x-litellm-api-key instead of Authorization Bearer
    expect(json._litellm).toBe("test-flock");
    expect(json._auth).toBe("");
  });
});

describe("GET /health", () => {
  test("returns ok without auth", async () => {
    const res = await gateway.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe("ok");
    expect(json.providers).toContain("OpenAI");
    expect(json.providers).toContain("Flock");
  });
});
