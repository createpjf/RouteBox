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

// ---------------------------------------------------------------------------
// Model aliases — map user-friendly short names to canonical API model IDs
// ---------------------------------------------------------------------------

export const MODEL_ALIASES: Record<string, string> = {
  // Anthropic short names
  "claude-3.5-sonnet":     "claude-3-5-sonnet-20241022",
  "claude-3-sonnet":       "claude-sonnet-4-20250514",
  "claude-3-haiku":        "claude-3-haiku-20240307",
  "claude-sonnet":         "claude-sonnet-4-20250514",
  "claude-haiku":          "claude-haiku-4-20250514",
  "claude-opus":           "claude-opus-4-20250514",
  // OpenAI short names
  "gpt-4o-latest":         "gpt-4o",
  // Google short names
  "gemini-flash":          "gemini-2.0-flash",
  "gemini-pro":            "gemini-2.5-pro",
};

/** Resolve a user-provided model name to the canonical model ID */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

// Pricing per 1 M tokens  { input, output }  — matches spec exactly
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o":           { input: 2.5,   output: 10 },
  "gpt-4o-mini":      { input: 0.15,  output: 0.6 },
  "gpt-4.1":          { input: 2,     output: 8 },
  "gpt-4.1-mini":     { input: 0.4,   output: 1.6 },
  "gpt-4.1-nano":     { input: 0.1,   output: 0.4 },
  "o3":               { input: 2,     output: 8 },
  "o3-mini":          { input: 1.1,   output: 4.4 },
  "o4-mini":          { input: 1.1,   output: 4.4 },
  "o1":               { input: 15,    output: 60 },
  "o1-mini":          { input: 3,     output: 12 },
  // Anthropic
  "claude-sonnet-4-20250514":   { input: 3,    output: 15 },
  "claude-haiku-4-20250514":    { input: 0.8,  output: 4 },
  "claude-opus-4-20250514":     { input: 15,   output: 75 },
  "claude-3-5-sonnet-20241022": { input: 3,    output: 15 },
  "claude-3-haiku-20240307":    { input: 0.25, output: 1.25 },
  // Google
  "gemini-2.5-pro":   { input: 1.25,  output: 10 },
  "gemini-2.5-flash": { input: 0.15,  output: 0.6 },
  "gemini-2.0-flash": { input: 0.075, output: 0.30 },
  "gemini-2.0-pro":   { input: 1.25,  output: 5 },
  // DeepSeek
  "deepseek-chat":     { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  // MiniMax
  "MiniMax-M2.5": { input: 0.80, output: 3.20 },
  "MiniMax-M2.1": { input: 0.50, output: 2.00 },
  // Kimi / Moonshot
  "kimi-k2.5":        { input: 0.60, output: 2.40 },
  "kimi-k2":          { input: 0.40, output: 1.60 },
  "kimi-k2-thinking": { input: 0.40, output: 1.60 },
  "moonshot-v1-128k": { input: 0.84, output: 0.84 },
  "moonshot-v1-32k":  { input: 0.34, output: 0.34 },
  // FLock — 5 spec models (via decentralized nodes)
  "qwen3-235b-a22b-thinking-2507":  { input: 0.70, output: 2.80 },
  "qwen3-30b-a3b-instruct-2507":    { input: 0.15, output: 0.60 },
  "qwen3-30b-a3b-instruct-coding":  { input: 0.15, output: 0.60 },
  "deepseek-v3.2":                   { input: 0.27, output: 1.10 },
};

/** Provider-specific pricing overrides (when a model is priced differently through a specific provider) */
export const PROVIDER_MODEL_PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  "FLock.io": {
    "kimi-k2-thinking": { input: 0.60, output: 2.40 },
  },
};

/** Model-level equivalence tiers for cross-provider routing */
export const MODEL_TIERS: Record<string, string[]> = {
  flagship: [
    "gpt-4o", "gpt-4.1",
    "claude-sonnet-4-20250514",
    "gemini-2.5-pro",
    "MiniMax-M2.5",
    "kimi-k2.5", "kimi-k2-thinking",
    "qwen3-235b-a22b-thinking-2507",
  ],
  fast: [
    "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano",
    "claude-haiku-4-20250514",
    "gemini-2.5-flash", "gemini-2.0-flash",
    "deepseek-chat",
    "MiniMax-M2.1",
    "kimi-k2", "moonshot-v1-32k",
    "qwen3-30b-a3b-instruct-2507", "qwen3-30b-a3b-instruct-coding", "deepseek-v3.2",
  ],
};

// ---------------------------------------------------------------------------
// Static provider registry — metadata only, no API keys
// ---------------------------------------------------------------------------

export interface ProviderTemplate {
  name: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  prefixes: string[];
  format: "openai" | "anthropic";
  /** Custom auth header name (default: "Authorization" with "Bearer " prefix) */
  authHeader?: string;
}

export const PROVIDER_REGISTRY: ProviderTemplate[] = [
  {
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseUrlEnvKey: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    prefixes: ["gpt-", "o1", "o3", "o4", "chatgpt-"],
    format: "openai",
  },
  {
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    baseUrlEnvKey: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    prefixes: ["claude-"],
    format: "anthropic",
  },
  {
    name: "Google",
    envKey: "GOOGLE_API_KEY",
    baseUrlEnvKey: "GOOGLE_BASE_URL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    prefixes: ["gemini-"],
    format: "openai",
  },
  {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    baseUrlEnvKey: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    prefixes: ["deepseek-"],
    format: "openai",
  },
  {
    name: "MiniMax",
    envKey: "MINIMAX_API_KEY",
    baseUrlEnvKey: "MINIMAX_BASE_URL",
    defaultBaseUrl: "https://api.minimax.io/v1",
    prefixes: ["MiniMax-"],
    format: "openai",
  },
  {
    name: "Kimi",
    envKey: "KIMI_API_KEY",
    baseUrlEnvKey: "KIMI_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    prefixes: ["kimi-", "moonshot-"],
    format: "openai",
  },
  {
    name: "FLock.io",
    envKey: "FLOCK_API_KEY",
    baseUrlEnvKey: "FLOCK_BASE_URL",
    defaultBaseUrl: "https://api.flock.io/v1",
    prefixes: ["qwen", "kimi-", "minimax-", "MiniMax-", "moonshot-", "deepseek-v3"],
    format: "openai",
    authHeader: "x-litellm-api-key",
  },
];

// ---------------------------------------------------------------------------
// Build provider configs from env + DB keys
// ---------------------------------------------------------------------------

function env(key: string): string {
  return process.env[key] ?? "";
}

/** Key source tracking for registry status endpoint */
export interface ProviderKeyInfo {
  hasKey: boolean;
  keySource: "env" | "db" | null;
  maskedKey: string | null;
  isActive: boolean;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function buildProviders(dbKeys?: Map<string, string>): ProviderConfig[] {
  const list: ProviderConfig[] = [];

  for (const tmpl of PROVIDER_REGISTRY) {
    const envApiKey = env(tmpl.envKey);
    const dbApiKey = dbKeys?.get(tmpl.name) ?? "";
    const apiKey = envApiKey || dbApiKey; // env takes precedence

    if (!apiKey) continue;

    list.push({
      name: tmpl.name,
      baseUrl: env(tmpl.baseUrlEnvKey) || tmpl.defaultBaseUrl,
      apiKey,
      prefixes: tmpl.prefixes,
      format: tmpl.format,
      keySource: "byok",
      authHeader: tmpl.authHeader,
    });
  }

  return list;
}

/** Get key status for all providers (used by registry endpoint) */
export function getProviderKeyStatus(dbKeys: Map<string, string>): Record<string, ProviderKeyInfo> {
  const result: Record<string, ProviderKeyInfo> = {};
  for (const tmpl of PROVIDER_REGISTRY) {
    const envApiKey = env(tmpl.envKey);
    const dbApiKey = dbKeys.get(tmpl.name) ?? "";
    const apiKey = envApiKey || dbApiKey;
    result[tmpl.name] = {
      hasKey: !!apiKey,
      keySource: envApiKey ? "env" : dbApiKey ? "db" : null,
      maskedKey: apiKey ? maskKey(apiKey) : null,
      isActive: !!apiKey,
    };
  }
  return result;
}

// Module-level mutable providers array
export let providers: ProviderConfig[] = buildProviders();

/** Rebuild providers from env + DB keys, then sync metrics */
export function rebuildProviders(dbKeys: Map<string, string>) {
  providers = buildProviders(dbKeys);
  console.log(`   Providers rebuilt: ${providers.map(p => p.name).join(", ") || "(none)"}`);
}

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

/** Lookup pricing — checks provider-specific overrides, then global, then prefix match */
export function pricingForModel(model: string, providerName?: string): { input: number; output: number } {
  // Check provider-specific pricing override first
  if (providerName && PROVIDER_MODEL_PRICING[providerName]?.[model]) {
    return PROVIDER_MODEL_PRICING[providerName][model];
  }
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
  providerName?: string,
): number {
  const p = pricingForModel(model, providerName);
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
            input: typeof fn.arguments === "string"
              ? (() => { try { return JSON.parse(fn.arguments as string); } catch { return {}; } })()
              : fn.arguments,
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
