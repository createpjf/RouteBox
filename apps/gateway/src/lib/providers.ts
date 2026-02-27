// ---------------------------------------------------------------------------
// Provider registry — config, model mapping, pricing, adapters
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Model prefixes this provider owns (matched with startsWith) */
  prefixes: string[];
  /** API format — all except Anthropic speak OpenAI */
  format: "openai" | "anthropic";
  keySource: "byok" | "pool";
  /** Custom auth header name (default: "Authorization" with "Bearer " prefix) */
  authHeader?: string;
}

// Pricing per 1 M tokens  { input, output }
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o":           { input: 2.5,  output: 10 },
  "gpt-4o-mini":      { input: 0.15, output: 0.6 },
  "gpt-4.1":          { input: 2,    output: 8 },
  "gpt-4.1-mini":     { input: 0.4,  output: 1.6 },
  "gpt-4.1-nano":     { input: 0.1,  output: 0.4 },
  "o3":               { input: 2,    output: 8 },
  "o3-mini":          { input: 1.1,  output: 4.4 },
  "o4-mini":          { input: 1.1,  output: 4.4 },
  // Anthropic
  "claude-sonnet-4-20250514":  { input: 3,   output: 15 },
  "claude-haiku-4-20250514":   { input: 0.8, output: 4 },
  "claude-opus-4-20250514":    { input: 15,  output: 75 },
  // Google
  "gemini-2.5-pro":     { input: 1.25, output: 10 },
  "gemini-2.5-flash":   { input: 0.15, output: 0.6 },
  "gemini-2.0-flash":   { input: 0.1,  output: 0.4 },
  // DeepSeek
  "deepseek-chat":      { input: 0.14, output: 0.28 },
  "deepseek-reasoner":  { input: 0.55, output: 2.19 },
  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  // Flock API platform models
  "qwen3-235b-a22b-instruct-2507":  { input: 0.3,  output: 1.2 },
  "qwen3-235b-a22b-thinking-2507":  { input: 0.3,  output: 1.2 },
  "qwen3-235b-a22b-thinking-qwfin": { input: 0.3,  output: 1.2 },
  "qwen3-30b-a3b-instruct-2507":    { input: 0.1,  output: 0.4 },
  "qwen3-30b-a3b-instruct-qmini":   { input: 0.1,  output: 0.4 },
  "qwen3-30b-a3b-instruct-qmxai":   { input: 0.1,  output: 0.4 },
  "qwen3-30b-a3b-instruct-coding":  { input: 0.1,  output: 0.4 },
  "deepseek-v3.2":                   { input: 0.14, output: 0.28 },
  "kimi-k2-thinking":                { input: 0.3,  output: 1.2 },
  "minimax-m2.1":                    { input: 0.2,  output: 0.8 },
};

/** Model-level equivalence tiers for cross-provider routing */
export const MODEL_TIERS: Record<string, string[]> = {
  flagship: [
    "gpt-4o", "gpt-4.1",
    "claude-sonnet-4-20250514",
    "gemini-2.5-pro",
    "mistral-large-latest",
    "qwen3-235b-a22b-instruct-2507", "qwen3-235b-a22b-thinking-2507",
    "kimi-k2-thinking",
  ],
  fast: [
    "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano",
    "claude-haiku-4-20250514",
    "gemini-2.5-flash", "gemini-2.0-flash",
    "deepseek-chat",
    "mistral-small-latest",
    "qwen3-30b-a3b-instruct-2507", "deepseek-v3.2", "minimax-m2.1",
  ],
};

// ---------------------------------------------------------------------------
// Build provider configs from env
// ---------------------------------------------------------------------------

function env(key: string): string {
  return process.env[key] ?? "";
}

function buildProviders(): ProviderConfig[] {
  const list: ProviderConfig[] = [];

  if (env("OPENAI_API_KEY")) {
    list.push({
      name: "OpenAI",
      baseUrl: env("OPENAI_BASE_URL") || "https://api.openai.com/v1",
      apiKey: env("OPENAI_API_KEY"),
      prefixes: ["gpt-", "o3", "o4", "chatgpt-"],
      format: "openai",
      keySource: "byok",
    });
  }

  if (env("ANTHROPIC_API_KEY")) {
    list.push({
      name: "Anthropic",
      baseUrl: env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com/v1",
      apiKey: env("ANTHROPIC_API_KEY"),
      prefixes: ["claude-"],
      format: "anthropic",
      keySource: "byok",
    });
  }

  if (env("GOOGLE_API_KEY")) {
    list.push({
      name: "Google",
      baseUrl: env("GOOGLE_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env("GOOGLE_API_KEY"),
      prefixes: ["gemini-"],
      format: "openai",
      keySource: "byok",
    });
  }

  if (env("DEEPSEEK_API_KEY")) {
    list.push({
      name: "DeepSeek",
      baseUrl: env("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1",
      apiKey: env("DEEPSEEK_API_KEY"),
      prefixes: ["deepseek-"],
      format: "openai",
      keySource: "byok",
    });
  }

  if (env("MISTRAL_API_KEY")) {
    list.push({
      name: "Mistral",
      baseUrl: env("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1",
      apiKey: env("MISTRAL_API_KEY"),
      prefixes: ["mistral-"],
      format: "openai",
      keySource: "byok",
    });
  }

  if (env("FLOCK_API_KEY")) {
    list.push({
      name: "Flock",
      baseUrl: env("FLOCK_BASE_URL") || "https://api.flock.io/v1",
      apiKey: env("FLOCK_API_KEY"),
      prefixes: ["qwen", "kimi-", "minimax-", "deepseek-v3"],
      format: "openai",
      keySource: "byok",
      authHeader: "x-litellm-api-key",
    });
  }

  return list;
}

export const providers: ProviderConfig[] = buildProviders();

/** Find the canonical provider for a model string (longest prefix wins) */
export function providerForModel(model: string): ProviderConfig | undefined {
  let best: ProviderConfig | undefined;
  let bestLen = 0;
  for (const p of providers) {
    for (const pfx of p.prefixes) {
      if (model.startsWith(pfx) && pfx.length > bestLen) {
        best = p;
        bestLen = pfx.length;
      }
    }
  }
  return best;
}

/** Lookup pricing — falls back to a best-effort prefix match */
export function pricingForModel(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // try prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 1, output: 3 }; // fallback estimate
}

/** Calculate cost in USD from token counts */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = pricingForModel(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Anthropic adapter — transform OpenAI ↔ Anthropic formats
// ---------------------------------------------------------------------------

export interface OpenAIChatRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  [key: string]: unknown;
}

// ── OpenAI → Anthropic message content conversion ─────────────────────────

function convertContentToAnthropic(content: unknown): unknown {
  // String content passes through
  if (typeof content === "string") return content;
  // Array of content parts — convert image_url parts
  if (Array.isArray(content)) {
    return content.map((part: Record<string, unknown>) => {
      if (part.type === "text") return part;
      if (part.type === "image_url") {
        const url = (part.image_url as Record<string, string>)?.url ?? "";
        // Base64 data URL → Anthropic base64 source
        const match = url.match(/^data:(image\/\w+);base64,(.+)/);
        if (match) {
          return {
            type: "image",
            source: { type: "base64", media_type: match[1], data: match[2] },
          };
        }
        // External URL → Anthropic url source
        return {
          type: "image",
          source: { type: "url", url },
        };
      }
      return part;
    });
  }
  return content;
}

// ── OpenAI tools → Anthropic tools conversion ────────────────────────────

function convertToolsToAnthropic(
  tools?: Record<string, unknown>[],
): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => {
    if (tool.type === "function") {
      const fn = tool.function as Record<string, unknown>;
      return {
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters ?? { type: "object", properties: {} },
      };
    }
    return tool;
  });
}

function convertToolChoiceToAnthropic(
  toolChoice: unknown,
): Record<string, unknown> | undefined {
  if (toolChoice === undefined || toolChoice === null) return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return undefined; // Anthropic has no "none"
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === "function" && tc.function) {
      return { type: "tool", name: (tc.function as Record<string, string>).name };
    }
  }
  return undefined;
}

export function toAnthropicRequest(req: OpenAIChatRequest) {
  // Extract system message and convert content
  let system: string | undefined;
  const messages: { role: string; content: unknown }[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      system = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    } else if (m.role === "tool") {
      // OpenAI tool result → Anthropic tool_result
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: (m as Record<string, unknown>).tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }],
      });
    } else {
      const role = m.role === "function" ? "user" : m.role;
      let content = convertContentToAnthropic(m.content);

      // Convert assistant messages with tool_calls to Anthropic format
      const toolCalls = (m as Record<string, unknown>).tool_calls as Record<string, unknown>[] | undefined;
      if (role === "assistant" && toolCalls?.length) {
        const blocks: Record<string, unknown>[] = [];
        // Add text if present
        if (typeof m.content === "string" && m.content) {
          blocks.push({ type: "text", text: m.content });
        }
        // Add tool_use blocks
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown>;
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: fn.name,
            input: typeof fn.arguments === "string" ? JSON.parse(fn.arguments as string) : fn.arguments,
          });
        }
        content = blocks;
      }

      messages.push({ role, content });
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? 4096,
    stream: req.stream ?? false,
  };
  if (system) body.system = system;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.top_p !== undefined) body.top_p = req.top_p;

  // Tools
  const anthropicTools = convertToolsToAnthropic(req.tools as Record<string, unknown>[] | undefined);
  if (anthropicTools) body.tools = anthropicTools;
  const toolChoice = convertToolChoiceToAnthropic(req.tool_choice);
  if (toolChoice) body.tool_choice = toolChoice;

  return body;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicNonStreamResponse {
  id: string;
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export function fromAnthropicResponse(res: AnthropicNonStreamResponse, model: string) {
  const textParts = res.content.filter((b) => b.type === "text");
  const toolParts = res.content.filter((b) => b.type === "tool_use");

  const text = textParts.map((b) => b.text ?? "").join("");

  // Build tool_calls array if tool_use blocks exist
  const toolCalls = toolParts.length > 0
    ? toolParts.map((b, i) => ({
        id: b.id ?? `call_${i}`,
        type: "function" as const,
        function: {
          name: b.name ?? "",
          arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}),
        },
      }))
    : undefined;

  const finishReason = res.stop_reason === "end_turn"
    ? "stop"
    : res.stop_reason === "tool_use"
      ? "tool_calls"
      : (res.stop_reason ?? "stop");

  return {
    id: res.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: res.usage.input_tokens,
      completion_tokens: res.usage.output_tokens,
      total_tokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  };
}
