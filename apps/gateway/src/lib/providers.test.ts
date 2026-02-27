import { describe, test, expect } from "bun:test";
import {
  pricingForModel,
  calculateCost,
  providerForModel,
  toAnthropicRequest,
  fromAnthropicResponse,
  type OpenAIChatRequest,
  type AnthropicNonStreamResponse,
} from "./providers";

// ── Pricing ─────────────────────────────────────────────────────────────────

describe("pricingForModel", () => {
  test("exact match", () => {
    const p = pricingForModel("gpt-4o");
    expect(p).toEqual({ input: 2.5, output: 10 });
  });

  test("prefix match (versioned model)", () => {
    const p = pricingForModel("gpt-4o-2024-08-06");
    expect(p).toEqual({ input: 2.5, output: 10 });
  });

  test("unknown model returns fallback", () => {
    const p = pricingForModel("unknown-model-xyz");
    expect(p).toEqual({ input: 1, output: 3 });
  });
});

describe("calculateCost", () => {
  test("gpt-4o cost calculation", () => {
    // 1000 input * 2.5/1M + 500 output * 10/1M = 0.0025 + 0.005 = 0.0075
    const cost = calculateCost("gpt-4o", 1000, 500);
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  test("zero tokens = zero cost", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });
});

// ── providerForModel ────────────────────────────────────────────────────────

describe("providerForModel", () => {
  test("returns undefined for unknown prefix", () => {
    expect(providerForModel("llama-3-70b")).toBeUndefined();
  });

  // Note: actual provider matching depends on env vars being set.
  // We test the function itself doesn't throw.
  test("does not throw on empty string", () => {
    expect(() => providerForModel("")).not.toThrow();
  });

  test("finds Flock for qwen models", () => {
    const p = providerForModel("qwen3-30b-a3b-instruct-2507");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Flock");
    expect(p!.authHeader).toBe("x-litellm-api-key");
  });
});

// ── toAnthropicRequest ──────────────────────────────────────────────────────

describe("toAnthropicRequest", () => {
  test("extracts system message", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    };
    const body = toAnthropicRequest(req);
    expect(body.system).toBe("You are helpful.");
    expect(body.messages).toHaveLength(1);
    expect((body.messages as { role: string }[])[0].role).toBe("user");
  });

  test("defaults max_tokens to 4096", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
    };
    expect(toAnthropicRequest(req).max_tokens).toBe(4096);
  });

  test("passes explicit max_tokens", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1000,
    };
    expect(toAnthropicRequest(req).max_tokens).toBe(1000);
  });

  test("passes temperature and top_p", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.7,
      top_p: 0.9,
    };
    const body = toAnthropicRequest(req);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });

  test("converts image_url (base64) to Anthropic image block", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What's this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
        ],
      }],
    };
    const body = toAnthropicRequest(req);
    const msgs = body.messages as { role: string; content: unknown[] }[];
    const content = msgs[0].content as Record<string, unknown>[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "What's this?" });
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "abc123" },
    });
  });

  test("converts image_url (external URL) to Anthropic url source", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
        ],
      }],
    };
    const body = toAnthropicRequest(req);
    const msgs = body.messages as { role: string; content: unknown[] }[];
    const content = msgs[0].content as Record<string, unknown>[];
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/cat.jpg" },
    });
  });

  test("converts OpenAI tools to Anthropic tools", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { loc: { type: "string" } } },
        },
      }],
    };
    const body = toAnthropicRequest(req);
    const tools = body.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("get_weather");
    expect(tools[0].description).toBe("Get weather");
    expect(tools[0].input_schema).toEqual({ type: "object", properties: { loc: { type: "string" } } });
  });

  test("converts tool_choice values", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ type: "function", function: { name: "f", parameters: {} } }],
      tool_choice: "required",
    };
    const body = toAnthropicRequest(req);
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  test("converts tool role messages to tool_result", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "user", content: "Weather?" },
        { role: "assistant", content: "Let me check.", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"loc":"SF"}' } }] } as any,
        { role: "tool", content: "72F sunny", tool_call_id: "call_1" } as any,
      ],
    };
    const body = toAnthropicRequest(req);
    const msgs = body.messages as { role: string; content: unknown }[];
    // tool message → user with tool_result
    const toolMsg = msgs[2];
    expect(toolMsg.role).toBe("user");
    const blocks = toolMsg.content as Record<string, unknown>[];
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].tool_use_id).toBe("call_1");
    expect(blocks[0].content).toBe("72F sunny");
  });

  test("converts assistant tool_calls to Anthropic tool_use blocks", () => {
    const req: OpenAIChatRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "user", content: "Weather?" },
        {
          role: "assistant",
          content: "Checking...",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"loc":"SF"}' },
          }],
        } as any,
      ],
    };
    const body = toAnthropicRequest(req);
    const msgs = body.messages as { role: string; content: unknown }[];
    const assistantContent = msgs[1].content as Record<string, unknown>[];
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0]).toEqual({ type: "text", text: "Checking..." });
    expect(assistantContent[1].type).toBe("tool_use");
    expect(assistantContent[1].id).toBe("call_1");
    expect(assistantContent[1].name).toBe("get_weather");
    expect(assistantContent[1].input).toEqual({ loc: "SF" });
  });
});

// ── fromAnthropicResponse ───────────────────────────────────────────────────

describe("fromAnthropicResponse", () => {
  test("text-only response", () => {
    const res: AnthropicNonStreamResponse = {
      id: "msg_123",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const oai = fromAnthropicResponse(res, "claude-sonnet-4-20250514");
    expect(oai.id).toBe("msg_123");
    expect(oai.object).toBe("chat.completion");
    expect(oai.choices[0].message.role).toBe("assistant");
    expect(oai.choices[0].message.content).toBe("Hello!");
    expect(oai.choices[0].finish_reason).toBe("stop");
    expect(oai.usage.prompt_tokens).toBe(10);
    expect(oai.usage.completion_tokens).toBe(5);
    expect(oai.usage.total_tokens).toBe(15);
  });

  test("tool_use response maps to tool_calls", () => {
    const res: AnthropicNonStreamResponse = {
      id: "msg_456",
      model: "claude-sonnet-4-20250514",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_01", name: "get_weather", input: { location: "SF" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 30 },
    };
    const oai = fromAnthropicResponse(res, "claude-sonnet-4-20250514");
    expect(oai.choices[0].finish_reason).toBe("tool_calls");
    expect(oai.choices[0].message.content).toBe("Let me check.");
    const toolCalls = (oai.choices[0].message as any).tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id).toBe("toolu_01");
    expect(toolCalls[0].type).toBe("function");
    expect(toolCalls[0].function.name).toBe("get_weather");
    expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ location: "SF" });
  });

  test("no tool_use blocks → no tool_calls field", () => {
    const res: AnthropicNonStreamResponse = {
      id: "msg_789",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Just text." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 3 },
    };
    const oai = fromAnthropicResponse(res, "claude-sonnet-4-20250514");
    expect((oai.choices[0].message as any).tool_calls).toBeUndefined();
  });
});
