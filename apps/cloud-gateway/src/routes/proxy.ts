// ---------------------------------------------------------------------------
// Cloud Proxy — /v1/chat/completions
// Retry + Fallback + Circuit Breaker for high availability
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
  cloudProviderForModel,
  cloudProvidersForModel,
  cloudProviders,
  type CloudProviderConfig,
} from "../lib/key-pool";
import { isProviderAllowed } from "../lib/provider-config";
import { buildRequestContext } from "../lib/request-context";
import { scoreAndRank, type ScoredCandidate } from "../lib/scoring-engine";
import { getCircuitBreaker } from "../lib/circuit-breaker";
import { deductCredits, recordCloudRequest } from "../lib/credits";
import { getMarkupForPlan } from "../lib/polar";
import { getRegistryEntry } from "../lib/model-registry";
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
  "claude-sonnet-4-20250514":   { input: 3,    output: 15 },
  "claude-haiku-4-20250514":    { input: 0.8,  output: 4 },
  "claude-opus-4-20250514":     { input: 15,   output: 75 },
  "claude-3-5-sonnet-20241022": { input: 3,    output: 15 },
  "claude-3-haiku-20240307":    { input: 0.25, output: 1.25 },
  "gemini-2.5-pro":   { input: 1.25,  output: 10 },
  "gemini-2.5-flash": { input: 0.15,  output: 0.6 },
  "gemini-2.0-flash": { input: 0.075, output: 0.30 },
  "gemini-2.0-pro":   { input: 1.25,  output: 5 },
  "deepseek-chat":     { input: 0.27, output: 1.10 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "MiniMax-M2.5": { input: 0.80, output: 3.20 },
  "MiniMax-M2.1": { input: 0.50, output: 2.00 },
  "kimi-k2.5":        { input: 0.60, output: 2.40 },
  "kimi-k2":          { input: 0.40, output: 1.60 },
  "moonshot-v1-128k": { input: 0.84, output: 0.84 },
  "moonshot-v1-32k":  { input: 0.34, output: 0.34 },
  // OpenRouter models
  "openrouter/stepfun/step-3.5-flash:free": { input: 0, output: 0 },
};

const MODEL_ALIASES: Record<string, string> = {
  "claude-3.5-sonnet":     "claude-3-5-sonnet-20241022",
  "claude-3-sonnet":       "claude-sonnet-4-20250514",
  "claude-3-haiku":        "claude-3-haiku-20240307",
  "claude-sonnet":         "claude-sonnet-4-20250514",
  "claude-haiku":          "claude-haiku-4-20250514",
  "claude-opus":           "claude-opus-4-20250514",
  "gpt-4o-latest":         "gpt-4o",
  "gemini-flash":          "gemini-2.0-flash",
  "gemini-pro":            "gemini-2.5-pro",
};

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

/** Cost in cents with plan-based markup */
export function calculateUserCostCents(model: string, inputTokens: number, outputTokens: number, markup: number): number {
  const providerCost = calculateCost(model, inputTokens, outputTokens);
  return Math.ceil(providerCost * markup * 100);
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
          reader.cancel().catch(() => {});
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
      push(JSON.stringify({
        object: "routebox.meta",
        provider: streamMeta.provider.toLowerCase(),
        model, requested_model: streamMeta.requestedModel,
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
        cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
        is_fallback: streamMeta.isFallback,
      }));
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
          reader.cancel().catch(() => {});
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
                enqueue(encoder.encode(`data: ${JSON.stringify({
                  object: "routebox.meta",
                  provider: streamMeta.provider.toLowerCase(),
                  model: streamMeta.requestedModel,
                  requested_model: streamMeta.requestedModel,
                  usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
                  cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
                  is_fallback: streamMeta.isFallback,
                })}\n\n`));
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
        enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          object: "routebox.meta",
          provider: streamMeta.provider.toLowerCase(),
          model: streamMeta.requestedModel,
          requested_model: streamMeta.requestedModel,
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTok },
          cost, latency_ms: Math.round(performance.now() - streamMeta.startMs),
          is_fallback: streamMeta.isFallback,
        })}\n\n`));
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

app.get("/models", (c) => {
  const userPlan = c.get("userPlan") ?? "free";
  const modelIds = new Set<string>();
  for (const p of cloudProviders) {
    if (!isProviderAllowed(p.name, userPlan)) continue;
    for (const modelId of Object.keys(MODEL_PRICING)) {
      if (p.prefixes.some((pfx) => modelId.startsWith(pfx))) {
        modelIds.add(modelId);
      }
    }
  }
  const data = [...modelIds].map((id) => ({
    id, object: "model" as const, created: 0, owned_by: "routebox",
  }));
  return c.json({ object: "list", data });
});

// ---------------------------------------------------------------------------
// POST /chat/completions — main handler with retry + fallback
// ---------------------------------------------------------------------------

app.post("/chat/completions", creditsCheck, async (c) => {
  const userId = c.get("userId") as string;
  const userPlan = c.get("userPlan") ?? "free";
  const markup = getMarkupForPlan(userPlan);
  const body = await c.req.json<ChatRequest>();

  // Validate
  if (!body.model || typeof body.model !== "string") {
    return c.json({ error: { message: "Missing required field: model", type: "invalid_request_error" } }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: { message: "Field 'messages' must be a non-empty array", type: "invalid_request_error" } }, 400);
  }
  if (body.messages.length > 100) {
    return c.json({ error: { message: "Too many messages (max 100)", type: "invalid_request_error" } }, 400);
  }
  if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) {
    return c.json({ error: { message: "temperature must be between 0 and 2", type: "invalid_request_error" } }, 400);
  }
  if (body.max_tokens !== undefined && (body.max_tokens < 1 || body.max_tokens > 200000)) {
    return c.json({ error: { message: "max_tokens must be between 1 and 200000", type: "invalid_request_error" } }, 400);
  }

  // Resolve alias
  const requestedModel = resolveAlias(body.model);
  body.model = requestedModel;
  const isStream = body.stream === true;

  // Strip prefix for OpenRouter models before forwarding
  // (provider matching uses full name, but OpenRouter API expects unprefixed)
  if (requestedModel.startsWith("openrouter/")) {
    body.model = requestedModel.slice("openrouter/".length);
  }

  // ── Model-level plan check ───────────────────────────────────────────────
  const modelEntry = await getRegistryEntry(requestedModel);
  if (modelEntry) {
    const allowed = modelEntry.allowedPlans ?? ["all"];
    if (!allowed.includes("all") && !allowed.includes(userPlan)) {
      return c.json({
        error: {
          message: `Model ${requestedModel} requires a higher plan`,
          type: "plan_restriction",
          code: "model_plan_restriction",
        },
      }, 403);
    }
  }

  // ── Scoring Engine → Provider Chain ─────────────────────────────────────
  // Try scoring engine first; fall back to prefix matching if model not in registry
  const routingStrategy = (c.req.header("x-routebox-strategy") ?? "smart_auto").toLowerCase();
  const requestContext = buildRequestContext(body);
  const scoredCandidates = await scoreAndRank({
    requestedModel,
    strategy: routingStrategy,
    context: requestContext,
    userPlan,
  });

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

  if (providerChain.length === 0) {
    return c.json({
      error: {
        message: `Model ${requestedModel} is not available on your plan`,
        type: "plan_restriction",
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

          return c.json({
            error: {
              message: `Provider ${provider.name} returned ${rawRes.status}`,
              type: "upstream_error",
              upstream: errBody.slice(0, 500),
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

      const costCents = calculateUserCostCents(requestedModel, usage.input, usage.output, markup);

      // Token metrics
      incCounter("provider_tokens_total", { provider: finalProvider.name, model: requestedModel, direction: "input" }, usage.input);
      incCounter("provider_tokens_total", { provider: finalProvider.name, model: requestedModel, direction: "output" }, usage.output);

      // Deduct credits (even for partial streams — bill consumed tokens)
      if (costCents > 0) {
        await deductCredits(userId, costCents, {
          model: requestedModel,
          provider: finalProvider.name,
          inputTokens: usage.input,
          outputTokens: usage.output,
        }).catch((err) => {
          log.error("deduct_credits_failed", {
            requestId, userId, model: requestedModel, costCents,
            error: err instanceof Error ? err.message : String(err),
          });
        });
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

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-RouteBox-Provider": activeProvider.name,
        "X-RouteBox-Model": requestedModel,
      },
    });
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
  const costCents = calculateUserCostCents(requestedModel, inputTokens, outputTokens, markup);
  const providerCost = calculateCost(requestedModel, inputTokens, outputTokens);

  // Token metrics
  incCounter("provider_tokens_total", { provider: activeProvider.name, model: requestedModel, direction: "input" }, inputTokens);
  incCounter("provider_tokens_total", { provider: activeProvider.name, model: requestedModel, direction: "output" }, outputTokens);

  // Deduct credits
  if (costCents > 0) {
    await deductCredits(userId, costCents, {
      model: requestedModel,
      provider: activeProvider.name,
      inputTokens, outputTokens,
    }).catch((err) => {
      log.error("deduct_credits_failed", {
        requestId, userId, model: requestedModel, costCents,
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
  (responseJson as Record<string, unknown>)._routebox = {
    routed_model: requestedModel,
    provider: activeProvider.name.toLowerCase(),
    instance_id: activeProvider.instanceId,
    cost: providerCost,
    user_cost_cents: costCents,
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    latency_ms: latencyMs,
    is_fallback: isFallback,
  };

  return c.json(responseJson, 200, {
    "X-RouteBox-Provider": activeProvider.name,
    "X-RouteBox-Model": requestedModel,
  });
});

export default app;
