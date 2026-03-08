// ---------------------------------------------------------------------------
// Cloud Proxy — /v1/chat/completions
// Retry + Fallback + Circuit Breaker for high availability
// ---------------------------------------------------------------------------

import { Hono, type Context } from "hono";
import {
  cloudProviderForModel,
  cloudProvidersForModel,
  cloudProviders,
  getOpenRouterFallbacks,
  type CloudProviderConfig,
} from "../lib/key-pool";
import { isProviderAllowed } from "../lib/provider-config";
import { buildRequestContext } from "../lib/request-context";
import { scoreAndRank, type ScoredCandidate } from "../lib/scoring-engine";
import { getCircuitBreaker } from "../lib/circuit-breaker";
import { sql } from "../lib/db-cloud";
import { deductCredits, recordCloudRequest } from "../lib/credits";
import { getMarkupForPlan } from "../lib/polar";
import { getRegistryEntry, getActiveModels } from "../lib/model-registry";
import { resolveStrategy } from "../lib/routing-config";
import { checkDailyQuota, incrementDailyQuota } from "../lib/quota";
import { log } from "../lib/logger";
import { incCounter, observeHistogram, incGauge, decGauge } from "../lib/metrics";
import { creditsCheck } from "../middleware/credits-check";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

const MAX_STREAM_BUFFER = 1024 * 1024; // 1 MB
const STREAM_IDLE_TIMEOUT_MS = 30_000; // close stream if no data for 30s
const REQUEST_TIMEOUT_MS = 60_000; // overall request timeout

// ---------------------------------------------------------------------------
// Retry + Fallback configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2; // total 3 attempts (1 original + 2 retries)
const BASE_DELAY_MS = 200; // first retry: ~200ms, second: ~400ms
const MAX_JITTER_MS = 100; // random jitter added to backoff

/** Sleep with exponential backoff + jitter */
export function backoff(attempt: number): Promise<void> {
  const base = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * MAX_JITTER_MS;
  return new Promise((r) => setTimeout(r, base + jitter));
}

/** Is this HTTP status retryable? 5xx = yes, 4xx = no */
export function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

// ---------------------------------------------------------------------------
// Model pricing (per 1M tokens) — duplicated from gateway for independence
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // MiniMax
  "minimax-m2.1":                                    { input: 0.27,  output: 0.95 },
  "minimax-m2.5":                                    { input: 0.30,  output: 1.20 },
  // FLock.io
  "gemini-3-flash-preview":                          { input: 0.50,  output: 3.00 },
  "gemini-3.1-pro-preview":                          { input: 2.00,  output: 12.00 },
  "qwen3-235b-a22b-instruct-2507":                   { input: 0.455, output: 1.82 },
  "qwen3-30b-a3b-instruct-2507":                     { input: 0.07,  output: 0.27 },
  "deepseek-v3.2":                                   { input: 0.28,  output: 0.42 },
  // Kimi
  "kimi-k2-thinking":                                { input: 0.60,  output: 2.50 },
  "kimi-k2.5":                                       { input: 0.60,  output: 3.00 },
  // OpenRouter
  "openrouter/stepfun/step-3.5-flash":               { input: 0.10,  output: 0.30 },
  "openrouter/qwen/qwen3-max-thinking":              { input: 0.78,  output: 3.90 },
  "openrouter/openai/gpt-5.4":                       { input: 2.50,  output: 20.00 },
  "openrouter/anthropic/claude-sonnet-4.6":          { input: 3.00,  output: 15.00 },
  "openrouter/qwen/qwen3-coder-next":                { input: 0.12,  output: 0.75 },
  "openrouter/arcee-ai/trinity-large-preview:free":  { input: 0,     output: 0 },
  // z.ai
  "z-ai/glm-5":                                      { input: 1.00,  output: 3.20 },
  "z-ai/glm-4.7":                                    { input: 0.60,  output: 2.20 },
};

const MODEL_ALIASES: Record<string, string> = {};

export function resolveAlias(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

export function pricingFor(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 1, output: 3 };
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricingFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Effective pricing for a model+plan combination.
 *  Registry-priced models (discount models) use fixed user prices (markup=1.0).
 *  All other models use MODEL_PRICING × plan markup. */
export async function getModelUserPrice(
  model: string,
  userPlan: string,
): Promise<{ input: number; output: number; markup: number }> {
  const entry = await getRegistryEntry(model);

  if (entry?.userPriceInput != null && entry?.userPriceOutput != null) {
    // Discount model: registry price already includes margin, no additional markup
    return { input: entry.userPriceInput, output: entry.userPriceOutput, markup: 1.0 };
  }

  // Legacy markup path
  const p = pricingFor(model);
  const markup = userPlan === "max" ? 1.05
               : userPlan === "pro" ? 1.08
               : 1.08; // starter same as pro
  return { input: p.input, output: p.output, markup };
}

/** Cost in cents using effective pricing (including markup) */
export function calculateUserCostCents(
  inputTokens: number,
  outputTokens: number,
  pricing: { input: number; output: number; markup: number },
): number {
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return Math.ceil(cost * pricing.markup * 100);
}

// ---------------------------------------------------------------------------
// Anthropic adapter (simplified — same logic as gateway)
// ---------------------------------------------------------------------------

interface ChatRequest {
  model: string;
  messages: { role: string; content: unknown }[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  [key: string]: unknown;
}

function toAnthropicRequest(req: ChatRequest) {
  let system: string | undefined;
  const messages: { role: string; content: unknown }[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      system = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    } else {
      messages.push({ role: m.role === "function" ? "user" : m.role, content: m.content });
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
  return body;
}

// ---------------------------------------------------------------------------
// Forward to provider
// ---------------------------------------------------------------------------

function forwardOpenAI(provider: CloudProviderConfig, body: ChatRequest, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.authHeader) {
    headers[provider.authHeader] = provider.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }
  // OpenRouter requires attribution headers
  if (provider.name === "OpenRouter") {
    headers["HTTP-Referer"] = process.env.APP_URL ?? "https://routebox.dev";
    headers["X-Title"] = "RouteBox";
  }
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function forwardAnthropic(provider: CloudProviderConfig, body: ChatRequest, signal?: AbortSignal): Promise<Response> {
  const anthropicBody = toAnthropicRequest(body);
  return fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function forward(provider: CloudProviderConfig, body: ChatRequest, signal?: AbortSignal): Promise<Response> {
  return provider.format === "anthropic"
    ? forwardAnthropic(provider, body, signal)
    : forwardOpenAI(provider, body, signal);
}

// ---------------------------------------------------------------------------
// Streaming: Anthropic SSE → OpenAI SSE
// ---------------------------------------------------------------------------

interface StreamMeta {
  provider: string;
  requestedModel: string;
  startMs: number;
  isFallback: boolean;
  autoRouted?: boolean;
  originalRequestedModel?: string;
}

function anthropicStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  streamMeta: StreamMeta,
  onDone: (usage: { input: number; output: number }) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let doneCalled = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const callOnDone = (usage: { input: number; output: number }) => {
    if (doneCalled) return;
    doneCalled = true;
    if (idleTimer) clearTimeout(idleTimer);
    onDone(usage);
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      function push(data: string) {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      }

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch((err) => {
            log.warn("stream_idle_cancel_failed", { error: err instanceof Error ? err.message : String(err) });
          });
          try { controller.close(); } catch { /* already closed */ }
          callOnDone({ input: inputTokens, output: outputTokens });
        }, STREAM_IDLE_TIMEOUT_MS);
      };

      resetIdleTimer();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer();
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > MAX_STREAM_BUFFER) break;
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const evt = JSON.parse(raw);
              if (evt.type === "message_start") {
                messageId = evt.message?.id ?? `chatcmpl-${Date.now()}`;
                inputTokens = evt.message?.usage?.input_tokens ?? 0;
              } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                push(JSON.stringify({
                  id: messageId, object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000), model,
                  choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }],
                }));
              } else if (evt.type === "message_delta") {
                outputTokens = evt.usage?.output_tokens ?? outputTokens;
                const reason = evt.delta?.stop_reason === "end_turn" ? "stop" : (evt.delta?.stop_reason ?? null);
                push(JSON.stringify({
                  id: messageId, object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000), model,
                  choices: [{ index: 0, delta: {}, finish_reason: reason }],
                }));
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* stream error — abort or network failure */ }
      finally { reader.releaseLock(); }

      if (idleTimer) clearTimeout(idleTimer);

      // Inject routebox.meta
      const totalTok = inputTokens + outputTokens;
      const cost = calculateCost(model, inputTokens, outputTokens);
      const metaObj: Record<string, unknown> = {
        object: "routebox.meta",
        provider: streamMeta.provider.toLowerCase(),
        model, requested_model: streamMeta.originalRequestedModel ?? streamMeta.requestedModel,
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
        cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
        is_fallback: streamMeta.isFallback,
      };
      if (streamMeta.autoRouted) metaObj.auto_routed = true;
      push(JSON.stringify(metaObj));
      push("[DONE]");
      try { controller.close(); } catch { /* already closed */ }
      callOnDone({ input: inputTokens, output: outputTokens });
    },
  });
}

// ---------------------------------------------------------------------------
// Streaming: OpenAI SSE pass-through
// ---------------------------------------------------------------------------

function openaiStreamPassthrough(
  upstream: ReadableStream<Uint8Array>,
  streamMeta: StreamMeta,
  onDone: (usage: { input: number; output: number }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let metaInjected = false;
  let doneCalled = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const callOnDone = (usage: { input: number; output: number }) => {
    if (doneCalled) return;
    doneCalled = true;
    if (idleTimer) clearTimeout(idleTimer);
    onDone(usage);
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const encoder = new TextEncoder();

      const enqueue = (data: Uint8Array) => {
        try { controller.enqueue(data); } catch { /* closed */ }
      };

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          reader.cancel().catch((err) => {
            log.warn("stream_idle_cancel_failed", { error: err instanceof Error ? err.message : String(err) });
          });
          try { controller.close(); } catch { /* already closed */ }
          callOnDone({ input: inputTokens, output: outputTokens });
        }, STREAM_IDLE_TIMEOUT_MS);
      };

      resetIdleTimer();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer();
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > MAX_STREAM_BUFFER) break;
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              if (line.includes("[DONE]")) {
                // Inject routebox.meta before [DONE]
                const totalTok = inputTokens + outputTokens;
                const cost = calculateCost(streamMeta.requestedModel, inputTokens, outputTokens);
                const metaObj: Record<string, unknown> = {
                  object: "routebox.meta",
                  provider: streamMeta.provider.toLowerCase(),
                  model: streamMeta.requestedModel,
                  requested_model: streamMeta.originalRequestedModel ?? streamMeta.requestedModel,
                  usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
                  cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
                  is_fallback: streamMeta.isFallback,
                };
                if (streamMeta.autoRouted) metaObj.auto_routed = true;
                enqueue(encoder.encode(`data: ${JSON.stringify(metaObj)}\n\n`));
                enqueue(encoder.encode(`${line}\n\n`));
                metaInjected = true;
              } else {
                try {
                  const chunk = JSON.parse(line.slice(6));
                  if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
                    outputTokens = chunk.usage.completion_tokens ?? outputTokens;
                  }
                } catch { /* skip */ }
                enqueue(encoder.encode(`${line}\n\n`));
              }
            } else if (line.trim()) {
              enqueue(encoder.encode(`${line}\n`));
            }
          }
        }
      } catch { /* stream error — abort or network failure */ }
      finally { reader.releaseLock(); }

      if (idleTimer) clearTimeout(idleTimer);

      // Fallback meta injection
      if (!metaInjected) {
        const totalTok = inputTokens + outputTokens;
        const cost = calculateCost(streamMeta.requestedModel, inputTokens, outputTokens);
        const metaObj: Record<string, unknown> = {
          object: "routebox.meta",
          provider: streamMeta.provider.toLowerCase(),
          model: streamMeta.requestedModel,
          requested_model: streamMeta.originalRequestedModel ?? streamMeta.requestedModel,
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
          cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
          is_fallback: streamMeta.isFallback,
        };
        if (streamMeta.autoRouted) metaObj.auto_routed = true;
        enqueue(new TextEncoder().encode(`data: ${JSON.stringify(metaObj)}\n\n`));
        enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      }
      try { controller.close(); } catch { /* already closed */ }
      callOnDone({ input: inputTokens, output: outputTokens });
    },
  });
}

// ---------------------------------------------------------------------------
// GET /models — available models
// ---------------------------------------------------------------------------

export async function modelsHandler(c: Context<CloudEnv>) {
  const userPlan = c.get("userPlan") ?? "starter";

  // Build set of allowed provider names for this plan
  const allowedProviders = new Set<string>();
  for (const p of cloudProviders) {
    if (isProviderAllowed(p.name, userPlan)) allowedProviders.add(p.name);
  }

  // 1. Load active/beta models from registry
  let registryModels: { modelId: string; displayName: string; provider: string; tier: string; status: string }[] = [];
  try {
    const active = await getActiveModels();
    registryModels = active.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      provider: m.provider,
      tier: m.tier,
      status: m.status,
    }));
  } catch (err) {
    log.error("registry_load_failed", {
      endpoint: "GET /models",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const seen = new Set<string>();
  const data: { id: string; object: "model"; created: number; owned_by: string; display_name: string; tier: string; status: string }[] = [];

  // 2. Registry models — check that at least one provider config exists
  for (const rm of registryModels) {
    if (seen.has(rm.modelId)) continue;
    // Check provider is allowed and has a matching config
    const hasProvider = cloudProviders.some(
      (p) => allowedProviders.has(p.name) && p.prefixes.some((pfx) => rm.modelId.startsWith(pfx)),
    );
    if (!hasProvider) continue;
    seen.add(rm.modelId);
    data.push({
      id: rm.modelId,
      object: "model",
      created: 0,
      owned_by: rm.provider,
      display_name: rm.displayName,
      tier: rm.tier,
      status: rm.status,
    });
  }

  // 3. MODEL_PRICING fallback — models not yet in registry
  for (const p of cloudProviders) {
    if (!allowedProviders.has(p.name)) continue;
    for (const modelId of Object.keys(MODEL_PRICING)) {
      if (seen.has(modelId)) continue;
      if (p.prefixes.some((pfx) => modelId.startsWith(pfx))) {
        seen.add(modelId);
        data.push({
          id: modelId,
          object: "model",
          created: 0,
          owned_by: p.name,
          display_name: modelId,
          tier: "fast",
          status: "active",
        });
      }
    }
  }

  // Prepend the virtual "auto" smart-routing model
  data.unshift({
    id: "auto",
    object: "model",
    created: 0,
    owned_by: "routebox",
    display_name: "Auto (Smart Routing)",
    tier: "auto",
    status: "active",
  });

  return c.json({ object: "list", data });
}

app.get("/models", modelsHandler);

// ---------------------------------------------------------------------------
// POST /chat/completions — main handler with retry + fallback
// ---------------------------------------------------------------------------

app.post("/chat/completions", creditsCheck, async (c) => {
  const userId = c.get("userId") as string;
  const userPlan = c.get("userPlan") ?? "starter";
  const body = await c.req.json<ChatRequest>();

  // Validate
  if (!body.model || typeof body.model !== "string") {
    return c.json({ error: { message: "Missing required field: model", type: "invalid_request_error", param: null, code: "invalid_request" } }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: { message: "Field 'messages' must be a non-empty array", type: "invalid_request_error", param: null, code: "invalid_request" } }, 400);
  }
  if (body.messages.length > 100) {
    return c.json({ error: { message: "Too many messages (max 100)", type: "invalid_request_error", param: null, code: "invalid_request" } }, 400);
  }
  if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) {
    return c.json({ error: { message: "temperature must be between 0 and 2", type: "invalid_request_error", param: null, code: "invalid_request" } }, 400);
  }
  if (body.max_tokens !== undefined && (body.max_tokens < 1 || body.max_tokens > 200000)) {
    return c.json({ error: { message: "max_tokens must be between 1 and 200000", type: "invalid_request_error", param: null, code: "invalid_request" } }, 400);
  }

  // Resolve alias
  let requestedModel = resolveAlias(body.model);
  body.model = requestedModel;
  const isStream = body.stream === true;

  // ── User routing rules (from header) ────────────────────────────────────
  const rulesHeader = c.req.header("x-routebox-rules");
  if (rulesHeader) {
    try {
      const rules: { matchType: string; matchValue: string; targetModel: string; enabled: boolean; priority: number }[] = JSON.parse(rulesHeader);
      const reqCtx = buildRequestContext(body);
      const sorted = rules.filter(r => r.enabled).sort((a, b) => b.priority - a.priority);
      for (const rule of sorted) {
        let matches = false;
        if (rule.matchType === "model_alias" && requestedModel === rule.matchValue) {
          matches = true;
        } else if (rule.matchType === "content_code" && reqCtx.contentType === "code") {
          matches = true;
        } else if (rule.matchType === "content_long" && reqCtx.contentType === "long_text") {
          matches = true;
        } else if (rule.matchType === "content_general") {
          matches = true;
        }
        if (matches) {
          body.model = rule.targetModel;
          requestedModel = rule.targetModel;
          log.info("user_routing_rule_applied", { requestId: c.get("requestId"), rule: rule.matchType, targetModel: rule.targetModel });
          break;
        }
      }
    } catch { /* invalid JSON, ignore */ }
  }

  // ── Detect auto routing (after user rules may have rewritten it) ────────
  const isAutoRoute = requestedModel === "auto";
  const originalRequestedModel = requestedModel; // preserve for metadata

  // Strip prefix for OpenRouter models before forwarding
  // (provider matching uses full name, but OpenRouter API expects unprefixed)
  if (!isAutoRoute && requestedModel.startsWith("openrouter/")) {
    body.model = requestedModel.slice("openrouter/".length);
  }

  // ── Scoring Engine setup ─────────────────────────────────────────────────
  const routingStrategy = resolveStrategy(userId, c.req.header("x-routebox-strategy")?.toLowerCase());
  const requestContext = buildRequestContext(body);
  let scoredCandidates: ScoredCandidate[] = [];

  if (isAutoRoute) {
    // ── Auto route: cross-tier scoring, skip per-model checks ─────────────
    try {
      scoredCandidates = await scoreAndRank({
        requestedModel: "auto",
        strategy: routingStrategy,
        context: requestContext,
        userPlan,
        crossTier: true,
      });
    } catch (err) {
      log.error("scoring_engine_failed", {
        requestId: c.get("requestId"),
        model: "auto",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (scoredCandidates.length === 0) {
      return c.json({
        error: {
          message: "No models available for auto routing",
          type: "server_error",
          param: null,
          code: "no_models_available",
        },
      }, 503);
    }

    // Select the top-scored model
    requestedModel = scoredCandidates[0].modelId;
    body.model = requestedModel;

    // Strip openrouter/ prefix if needed
    if (requestedModel.startsWith("openrouter/")) {
      body.model = requestedModel.slice("openrouter/".length);
    }

    log.info("auto_route_selected", {
      requestId: c.get("requestId"),
      selectedModel: requestedModel,
      strategy: routingStrategy,
      candidates: scoredCandidates.length,
      topScore: scoredCandidates[0]?.totalScore.toFixed(3),
    });

    // Quota check on the selected model
    const quotaResult = await checkDailyQuota(userId, requestedModel, userPlan);
    if (!quotaResult.allowed) {
      return c.json({
        error: {
          message: `Daily quota exceeded for ${requestedModel}. Resets at midnight UTC.`,
          type: "invalid_request_error",
          param: null,
          code: "daily_quota_exceeded",
          reset_at: quotaResult.resetAt.toISOString(),
          remaining: 0,
        },
      }, 429);
    }
  } else {
    // ── Normal route: per-model checks ─────────────────────────────────────

    // Disabled model check
    {
      const [disabledRow] = await sql`
        SELECT 1 FROM model_registry WHERE model_id = ${requestedModel} AND status = 'disabled' LIMIT 1
      `.catch((err) => {
        log.error("disabled_check_failed", {
          model: requestedModel,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
      if (disabledRow) {
        return c.json({
          error: {
            message: "This model is currently unavailable",
            type: "invalid_request_error",
            param: null,
            code: "model_disabled",
          },
        }, 403);
      }
    }

    // Model-level plan check
    const modelEntry = await getRegistryEntry(requestedModel);
    if (modelEntry) {
      const allowed = modelEntry.allowedPlans ?? ["all"];
      if (!allowed.includes("all") && !allowed.includes(userPlan)) {
        return c.json({
          error: {
            message: `Model ${requestedModel} requires a higher plan`,
            type: "invalid_request_error",
            param: null,
            code: "model_plan_restriction",
          },
        }, 403);
      }
    }

    // Daily quota check (Starter plan)
    const quotaResult = await checkDailyQuota(userId, requestedModel, userPlan);
    if (!quotaResult.allowed) {
      return c.json({
        error: {
          message: `Daily quota exceeded for ${requestedModel}. Resets at midnight UTC.`,
          type: "invalid_request_error",
          param: null,
          code: "daily_quota_exceeded",
          reset_at: quotaResult.resetAt.toISOString(),
          remaining: 0,
        },
      }, 429);
    }

    // Normal scoring
    try {
      scoredCandidates = await scoreAndRank({
        requestedModel,
        strategy: routingStrategy,
        context: requestContext,
        userPlan,
      });
    } catch (err) {
      log.error("scoring_engine_failed", {
        requestId: c.get("requestId"),
        model: requestedModel,
        error: err instanceof Error ? err.message : String(err),
      });
      // Degrade to prefix-match routing below
    }
  }

  // ── Pre-resolve effective pricing (after model is finalized) ─────────────
  const modelPricing = await getModelUserPrice(requestedModel, userPlan);

  let providerChain: CloudProviderConfig[];

  if (scoredCandidates.length > 0) {
    // Scoring engine found candidates — flatten provider configs in score order
    providerChain = [];
    for (const candidate of scoredCandidates) {
      // Swap model ID in body to the candidate's model ID for fallback routing
      for (const config of candidate.providerConfigs) {
        providerChain.push({
          ...config,
          // Attach scored model info for body rewriting
          _scoredModelId: candidate.modelId,
          _isScoredFallback: candidate.isFallback,
        } as CloudProviderConfig & { _scoredModelId: string; _isScoredFallback: boolean });
      }
    }
    log.info("scoring_route", {
      requestId: c.get("requestId"),
      requestedModel,
      strategy: routingStrategy,
      candidates: scoredCandidates.length,
      topModel: scoredCandidates[0]?.modelId,
      topScore: scoredCandidates[0]?.totalScore.toFixed(3),
    });
  } else {
    // Fallback to classic prefix-match routing
    providerChain = cloudProvidersForModel(requestedModel)
      .filter((p) => isProviderAllowed(p.name, userPlan));
  }

  // If no direct provider found, try OpenRouter as universal fallback
  if (providerChain.length === 0) {
    const orFallbacks = getOpenRouterFallbacks()
      .filter((p) => isProviderAllowed(p.name, userPlan));
    if (orFallbacks.length > 0) {
      providerChain = orFallbacks;
      log.info("openrouter_fallback", { requestId: c.get("requestId"), model: requestedModel });
    }
  }

  if (providerChain.length === 0) {
    return c.json({
      error: {
        message: `Model ${requestedModel} is not available on your plan`,
        type: "invalid_request_error",
        param: null,
        code: "model_not_available",
      },
    }, 403);
  }

  const requestId = c.get("requestId");
  const startMs = performance.now();

  // ── AbortSignal — propagate client disconnect to upstream ──────────────────
  const clientSignal = c.req.raw.signal;
  const abortController = new AbortController();
  const upstreamSignal = abortController.signal;

  // Abort upstream when client disconnects
  const onClientAbort = () => abortController.abort();
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });

  // Overall request timeout
  const requestTimeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  // ── Retry + Fallback Loop ──────────────────────────────────────────────────
  let lastError: { message: string; status?: number; body?: string } | undefined;
  let res: Response | undefined;
  let activeProvider: CloudProviderConfig | undefined;
  let activeProviderLatencyMs = 0;
  let isFallback = false;
  let totalAttempts = 0;

  for (let providerIdx = 0; providerIdx < providerChain.length; providerIdx++) {
    const provider = providerChain[providerIdx]!;
    const cb = getCircuitBreaker(provider.instanceId);

    // Skip providers with open circuit breakers
    if (!cb.canRequest()) {
      log.debug("circuit_breaker_skip", {
        requestId,
        provider: provider.instanceId,
        state: cb.getState(),
      });
      continue;
    }

    // Prepare body for this provider's format
    const providerBody = { ...body };

    // If scoring engine selected a different model, rewrite the model ID
    const scored = provider as CloudProviderConfig & { _scoredModelId?: string; _isScoredFallback?: boolean };
    if (scored._scoredModelId) {
      providerBody.model = scored._scoredModelId;
      if (scored._isScoredFallback) isFallback = true;
    }
    if (isStream && provider.format === "openai") {
      providerBody.stream_options = { include_usage: true };
    }

    const maxAttempts = MAX_RETRIES + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      totalAttempts++;
      const providerStartMs = performance.now();

      try {
        const rawRes = await forward(provider, providerBody, upstreamSignal);
        const providerLatencyMs = Math.round(performance.now() - providerStartMs);

        if (rawRes.ok) {
          // SUCCESS
          cb.onSuccess();
          incCounter("provider_requests_total", {
            provider: provider.name,
            model: requestedModel,
            status: "200",
          });
          observeHistogram("provider_request_duration_ms", providerLatencyMs, {
            provider: provider.name,
          });

          res = rawRes;
          activeProvider = provider;
          activeProviderLatencyMs = providerLatencyMs;
          isFallback = providerIdx > 0;
          break; // exit retry loop

        } else if (!isRetryableStatus(rawRes.status)) {
          // 4xx — client error, do NOT retry
          const errBody = await rawRes.text().catch(() => "");
          incCounter("provider_requests_total", {
            provider: provider.name,
            model: requestedModel,
            status: String(rawRes.status),
          });
          observeHistogram("provider_request_duration_ms", providerLatencyMs, {
            provider: provider.name,
          });

          // Log full upstream error server-side; return sanitized message to client
          log.warn("provider_client_error", {
            requestId,
            provider: provider.instanceId,
            model: requestedModel,
            status: rawRes.status,
            upstream: errBody.slice(0, 500),
          });
          return c.json({
            error: {
              message: `Provider returned ${rawRes.status}`,
              type: "invalid_request_error",
              param: null,
              code: "upstream_error",
            },
          }, rawRes.status as 400 | 401 | 403 | 404 | 429);

        } else {
          // 5xx — retryable server error
          const errBody = await rawRes.text().catch(() => "");
          cb.onFailure();
          incCounter("provider_requests_total", {
            provider: provider.name,
            model: requestedModel,
            status: String(rawRes.status),
          });
          observeHistogram("provider_request_duration_ms", providerLatencyMs, {
            provider: provider.name,
          });
          incCounter("errors_total", { type: "upstream_error" });

          lastError = {
            message: `Provider ${provider.name} returned ${rawRes.status}`,
            status: rawRes.status,
            body: errBody.slice(0, 500),
          };

          log.warn("provider_error_retryable", {
            requestId,
            userId,
            provider: provider.instanceId,
            model: requestedModel,
            status: rawRes.status,
            attempt: attempt + 1,
            maxAttempts,
            willRetry: attempt < maxAttempts - 1 && cb.canRequest(),
          });

          if (attempt < maxAttempts - 1 && cb.canRequest()) {
            await backoff(attempt);
          }
        }
      } catch (err) {
        // Network error — retryable
        const providerLatencyMs = Math.round(performance.now() - providerStartMs);
        cb.onFailure();
        incCounter("provider_requests_total", {
          provider: provider.name,
          model: requestedModel,
          status: "error",
        });
        observeHistogram("provider_request_duration_ms", providerLatencyMs, {
          provider: provider.name,
        });
        incCounter("errors_total", { type: "provider_unreachable" });

        lastError = {
          message: `Provider ${provider.name} unreachable: ${err instanceof Error ? err.message : String(err)}`,
        };

        log.error("provider_unreachable", {
          requestId,
          userId,
          provider: provider.instanceId,
          model: requestedModel,
          attempt: attempt + 1,
          maxAttempts,
          providerLatencyMs,
          error: err instanceof Error ? err.message : String(err),
        });

        if (attempt < maxAttempts - 1 && cb.canRequest()) {
          await backoff(attempt);
        }
      }
    }

    // If we got a successful response, exit the provider loop
    if (res) break;

    // Log fallback to next provider
    if (providerIdx < providerChain.length - 1) {
      log.info("provider_fallback", {
        requestId,
        failedProvider: provider.instanceId,
        nextProvider: providerChain[providerIdx + 1]!.instanceId,
      });
    }
  }

  // ── All providers exhausted ──
  if (!res || !activeProvider) {
    clearTimeout(requestTimeout);
    clientSignal?.removeEventListener("abort", onClientAbort);
    incCounter("errors_total", { type: "all_providers_failed" });
    return c.json({
      error: {
        message: lastError?.message ?? "All providers failed",
        type: "server_error",
        param: null,
        code: "service_unavailable",
        upstream: lastError?.body,
      },
    }, 502);
  }

  // Track retry metrics
  if (totalAttempts > 1) {
    incCounter("retry_attempts_total", {
      model: requestedModel,
      final_provider: activeProvider.instanceId,
    }, totalAttempts - 1);
  }

  // ── Streaming response ──
  if (isStream && res.body) {
    const streamMetaObj: StreamMeta = {
      provider: activeProvider.name,
      requestedModel,
      startMs,
      isFallback,
      autoRouted: isAutoRoute,
      originalRequestedModel: isAutoRoute ? "auto" : undefined,
    };

    // Capture variables for the async onDone closure
    const finalProvider = activeProvider;

    // Streaming metrics
    incGauge("stream_connections_active");
    const wasAborted = clientSignal?.aborted === true;

    const onDone = async (usage: { input: number; output: number }) => {
      clearTimeout(requestTimeout);
      clientSignal?.removeEventListener("abort", onClientAbort);
      decGauge("stream_connections_active");

      const latencyMs = Math.round(performance.now() - startMs);
      observeHistogram("stream_duration_ms", latencyMs, { provider: finalProvider.name });

      // Track if client aborted
      if (clientSignal?.aborted && !wasAborted) {
        incCounter("stream_aborted_total", { provider: finalProvider.name, model: requestedModel });
      }

      const costCents = calculateUserCostCents(usage.input, usage.output, modelPricing);

      // Token metrics
      incCounter("provider_tokens_total", { provider: finalProvider.name, model: requestedModel, direction: "input" }, usage.input);
      incCounter("provider_tokens_total", { provider: finalProvider.name, model: requestedModel, direction: "output" }, usage.output);

      // Deduct credits (even for partial streams — bill consumed tokens)
      if (costCents > 0) {
        const deductResult = await deductCredits(userId, costCents, {
          model: requestedModel,
          provider: finalProvider.name,
          inputTokens: usage.input,
          outputTokens: usage.output,
        }).catch((err) => {
          log.error("deduct_credits_failed", {
            requestId, userId, model: requestedModel, costCents,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });
        if (deductResult && !deductResult.success) {
          log.error("deduct_credits_insufficient", { requestId, userId, model: requestedModel, costCents });
        }
      }

      // Increment daily quota — skip on zero-token responses
      if (usage.input + usage.output > 0) {
        try {
          await incrementDailyQuota(userId, requestedModel);
        } catch (err) {
          log.error("quota_increment_failed", { userId, model: requestedModel, error: err instanceof Error ? err.message : String(err) });
        }
      }

      // Record request
      const status = clientSignal?.aborted && !wasAborted ? "aborted" : "ok";
      await recordCloudRequest(
        userId, requestedModel, finalProvider.name,
        usage.input, usage.output, costCents, latencyMs, status,
      ).catch((err) => {
        log.error("record_request_failed", {
          requestId, userId, model: requestedModel,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };

    const stream = activeProvider.format === "anthropic"
      ? anthropicStreamToOpenAI(res.body, requestedModel, streamMetaObj, onDone)
      : openaiStreamPassthrough(res.body, streamMetaObj, onDone);

    const streamHeaders: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-RouteBox-Provider": activeProvider.name,
      "X-RouteBox-Model": requestedModel,
    };
    if (isAutoRoute) streamHeaders["X-RouteBox-Auto-Routed"] = "true";

    return new Response(stream, { headers: streamHeaders });
  }

  // ── Non-streaming response ──
  clearTimeout(requestTimeout);
  clientSignal?.removeEventListener("abort", onClientAbort);
  const latencyMs = Math.round(performance.now() - startMs);
  const json = await res.json() as Record<string, unknown>;

  // Extract usage
  const usage = json.usage as Record<string, number> | undefined;
  const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const costCents = calculateUserCostCents(inputTokens, outputTokens, modelPricing);
  const providerCost = calculateCost(requestedModel, inputTokens, outputTokens);

  // Token metrics
  incCounter("provider_tokens_total", { provider: activeProvider.name, model: requestedModel, direction: "input" }, inputTokens);
  incCounter("provider_tokens_total", { provider: activeProvider.name, model: requestedModel, direction: "output" }, outputTokens);

  // Deduct credits
  if (costCents > 0) {
    const deductResult = await deductCredits(userId, costCents, {
      model: requestedModel,
      provider: activeProvider.name,
      inputTokens, outputTokens,
    }).catch((err) => {
      log.error("deduct_credits_failed", {
        requestId, userId, model: requestedModel, costCents,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (deductResult && !deductResult.success) {
      log.error("deduct_credits_insufficient", { requestId, userId, model: requestedModel, costCents });
    }
  }

  // Increment daily quota — skip on zero-token responses
  if (inputTokens + outputTokens > 0) {
    try {
      await incrementDailyQuota(userId, requestedModel);
    } catch (err) {
      log.error("quota_increment_failed", { userId, model: requestedModel, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Record request
  await recordCloudRequest(
    userId, requestedModel, activeProvider.name,
    inputTokens, outputTokens, costCents, latencyMs, "ok",
  ).catch((err) => {
    log.error("record_request_failed", {
      requestId, userId, model: requestedModel,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Transform Anthropic → OpenAI if needed
  let responseJson = json;
  if (activeProvider.format === "anthropic") {
    const content = (json as { content?: { type: string; text?: string }[] }).content ?? [];
    const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    responseJson = {
      id: (json as { id: string }).id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    };
  }

  // Inject _routebox metadata
  const routeboxMeta: Record<string, unknown> = {
    routed_model: requestedModel,
    requested_model: isAutoRoute ? "auto" : requestedModel,
    provider: activeProvider.name.toLowerCase(),
    instance_id: activeProvider.instanceId,
    cost: providerCost,
    user_cost_cents: costCents,
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    latency_ms: latencyMs,
    is_fallback: isFallback,
  };
  if (isAutoRoute) routeboxMeta.auto_routed = true;
  (responseJson as Record<string, unknown>)._routebox = routeboxMeta;

  const responseHeaders: Record<string, string> = {
    "X-RouteBox-Provider": activeProvider.name,
    "X-RouteBox-Model": requestedModel,
  };
  if (isAutoRoute) responseHeaders["X-RouteBox-Auto-Routed"] = "true";

  return c.json(responseJson, 200, responseHeaders);
});

export default app;
