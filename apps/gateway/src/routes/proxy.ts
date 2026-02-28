// ---------------------------------------------------------------------------
// POST /v1/chat/completions — OpenAI-compatible proxy
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  type ProviderConfig,
  type OpenAIChatRequest,
  toAnthropicRequest,
  fromAnthropicResponse,
  calculateCost,
  resolveModelAlias,
} from "../lib/providers";
import { selectRoute } from "../lib/router";
import { metrics, type RequestRecord } from "../lib/metrics";

const app = new Hono();

const MAX_STREAM_BUFFER = 1024 * 1024; // 1 MB — reject malformed streams that never emit newlines

// ── In-memory rate limiter: 60 requests per minute per auth token ────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

// Clean up stale buckets every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60_000);

function checkRateLimit(token: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket = rateBuckets.get(token);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(token, bucket);
  }

  bucket.count++;

  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  return { allowed: true, retryAfterMs: 0 };
}

// ── Non-streaming helpers ───────────────────────────────────────────────────

async function forwardOpenAI(
  provider: ProviderConfig,
  body: OpenAIChatRequest,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.authHeader) {
    headers[provider.authHeader] = provider.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function forwardAnthropic(
  provider: ProviderConfig,
  body: OpenAIChatRequest,
): Promise<Response> {
  const anthropicBody = toAnthropicRequest(body);
  return fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
    signal: AbortSignal.timeout(30_000),
  });
}

async function forward(
  provider: ProviderConfig,
  body: OpenAIChatRequest,
): Promise<Response> {
  return provider.format === "anthropic"
    ? forwardAnthropic(provider, body)
    : forwardOpenAI(provider, body);
}

// ── Extract usage from provider response (non-stream) ───────────────────────

function extractUsage(json: Record<string, unknown>): { input: number; output: number } {
  // OpenAI shape
  const usage = json.usage as Record<string, number> | undefined;
  if (usage?.prompt_tokens !== undefined) {
    return { input: usage.prompt_tokens, output: usage.completion_tokens ?? 0 };
  }
  // Anthropic shape
  if (usage?.input_tokens !== undefined) {
    return { input: usage.input_tokens, output: usage.output_tokens ?? 0 };
  }
  return { input: 0, output: 0 };
}

// ── Streaming: Anthropic SSE → OpenAI SSE transformer ───────────────────────

function anthropicStreamToOpenAI(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  onDone: (usage: { input: number; output: number }) => void,
  routeboxMeta?: { requestedModel: string; providerName: string },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let messageId = "";
  let inputTokens = 0;
  let outputTokens = 0;

  // Track tool_use blocks being streamed
  let currentToolCallId = "";
  let currentToolCallName = "";
  let currentToolCallInput = "";
  let toolCallIndex = -1;

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();

      function pushChunk(data: string) {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > MAX_STREAM_BUFFER) {
            controller.error(new Error("Stream buffer overflow"));
            break;
          }

          const lines = buffer.split("\n");
          buffer = lines.pop()!; // keep incomplete line

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const raw = line.slice(6).trim();
              if (!raw) continue;
              try {
                const evt = JSON.parse(raw);
                if (evt.type === "message_start") {
                  messageId = evt.message?.id ?? `chatcmpl-${Date.now()}`;
                  inputTokens = evt.message?.usage?.input_tokens ?? 0;
                } else if (evt.type === "content_block_start") {
                  if (evt.content_block?.type === "tool_use") {
                    // New tool call block
                    toolCallIndex++;
                    currentToolCallId = evt.content_block.id ?? `call_${toolCallIndex}`;
                    currentToolCallName = evt.content_block.name ?? "";
                    currentToolCallInput = "";
                    pushChunk(JSON.stringify({
                      id: messageId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolCallIndex,
                            id: currentToolCallId,
                            type: "function",
                            function: { name: currentToolCallName, arguments: "" },
                          }],
                        },
                        finish_reason: null,
                      }],
                    }));
                  }
                } else if (evt.type === "content_block_delta") {
                  if (evt.delta?.type === "text_delta" && evt.delta?.text) {
                    pushChunk(JSON.stringify({
                      id: messageId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }],
                    }));
                  } else if (evt.delta?.type === "input_json_delta" && evt.delta?.partial_json) {
                    // Stream tool call arguments
                    currentToolCallInput += evt.delta.partial_json;
                    pushChunk(JSON.stringify({
                      id: messageId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: toolCallIndex,
                            function: { arguments: evt.delta.partial_json },
                          }],
                        },
                        finish_reason: null,
                      }],
                    }));
                  }
                } else if (evt.type === "message_delta") {
                  outputTokens = evt.usage?.output_tokens ?? outputTokens;
                  const stopReason = evt.delta?.stop_reason;
                  const reason = stopReason === "end_turn" ? "stop"
                    : stopReason === "tool_use" ? "tool_calls"
                    : (stopReason ?? null);
                  pushChunk(JSON.stringify({
                    id: messageId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, delta: {}, finish_reason: reason }],
                  }));
                }
              } catch {
                // skip malformed
              }
            }
          }
        }
      } catch (err) {
        // Send SSE error event to the client
        const errorMessage = err instanceof Error ? err.message : "Stream read error";
        pushChunk(JSON.stringify({
          error: { message: errorMessage, type: "stream_error" },
        }));
      } finally {
        reader.releaseLock();
      }

      // Inject _routebox metadata before [DONE]
      if (routeboxMeta) {
        const cost = calculateCost(model, inputTokens, outputTokens);
        const originalCost = routeboxMeta.requestedModel !== model
          ? calculateCost(routeboxMeta.requestedModel, inputTokens, outputTokens)
          : cost;
        pushChunk(JSON.stringify({
          _routebox: {
            routed_model: model,
            provider: routeboxMeta.providerName.toLowerCase(),
            cost,
            saved: Math.max(0, originalCost - cost),
            key_source: "byok",
          },
        }));
      }

      pushChunk("[DONE]");
      controller.close();
      onDone({ input: inputTokens, output: outputTokens });
    },
  });
}

// ── Streaming: OpenAI SSE pass-through with usage capture ───────────────────

function openaiStreamPassthrough(
  upstream: ReadableStream<Uint8Array>,
  onDone: (usage: { input: number; output: number }) => void,
  routeboxMeta?: { model: string; requestedModel: string; providerName: string },
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const encoder = new TextEncoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse for usage and intercept [DONE] to inject _routebox
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > MAX_STREAM_BUFFER) {
            controller.error(new Error("Stream buffer overflow"));
            break;
          }
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              if (line.includes("[DONE]")) {
                // Inject _routebox before [DONE]
                if (routeboxMeta) {
                  const cost = calculateCost(routeboxMeta.model, inputTokens, outputTokens);
                  const originalCost = routeboxMeta.requestedModel !== routeboxMeta.model
                    ? calculateCost(routeboxMeta.requestedModel, inputTokens, outputTokens)
                    : cost;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    _routebox: {
                      routed_model: routeboxMeta.model,
                      provider: routeboxMeta.providerName.toLowerCase(),
                      cost,
                      saved: Math.max(0, originalCost - cost),
                      key_source: "byok",
                    },
                  })}\n\n`));
                }
                controller.enqueue(encoder.encode(`${line}\n\n`));
              } else {
                try {
                  const chunk = JSON.parse(line.slice(6));
                  if (chunk.usage) {
                    inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
                    outputTokens = chunk.usage.completion_tokens ?? outputTokens;
                  }
                } catch { /* skip */ }
                controller.enqueue(encoder.encode(`${line}\n\n`));
              }
            } else if (line.trim()) {
              // Pass through non-data lines (e.g. event: lines)
              controller.enqueue(encoder.encode(`${line}\n`));
            }
          }
        }
      } catch (err) {
        // Send SSE error event to the client
        const errorMessage = err instanceof Error ? err.message : "Stream read error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: errorMessage, type: "stream_error" } })}\n\n`));
      } finally {
        reader.releaseLock();
      }
      controller.close();
      onDone({ input: inputTokens, output: outputTokens });
    },
  });
}

// ── Main handler ────────────────────────────────────────────────────────────

app.post("/chat/completions", async (c) => {
  if (metrics.trafficPaused) {
    return c.json({ error: { message: "Traffic is paused", type: "server_error", code: "traffic_paused" } }, 503);
  }

  // ── Rate limit check ──
  const authHeader = c.req.header("Authorization") ?? "";
  const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "anonymous";
  const rateCheck = checkRateLimit(authToken);
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil(rateCheck.retryAfterMs / 1000);
    return c.json({
      error: {
        message: `Rate limit exceeded: max ${RATE_LIMIT_MAX} requests per minute. Retry after ${retryAfterSec}s.`,
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    }, 429);
  }

  const body = await c.req.json<OpenAIChatRequest>();

  // Validate required model field
  if (!body.model || typeof body.model !== "string" || !body.model.trim()) {
    return c.json({
      error: { message: "Missing required field: model", type: "invalid_request_error" },
    }, 400);
  }

  // Validate messages field
  if (!Array.isArray(body.messages)) {
    return c.json({
      error: { message: "Field 'messages' must be an array", type: "invalid_request_error" },
    }, 400);
  }
  if (body.messages.length === 0) {
    return c.json({
      error: { message: "Field 'messages' must not be empty", type: "invalid_request_error" },
    }, 400);
  }
  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (!msg.role || typeof msg.role !== "string") {
      return c.json({
        error: { message: `messages[${i}].role must be a non-empty string`, type: "invalid_request_error" },
      }, 400);
    }
  }

  // Reject oversized request bodies (>1MB)
  if (JSON.stringify(body).length > 1_000_000) {
    return c.json({
      error: { message: "Request body too large (max 1MB)", type: "invalid_request_error" },
    }, 400);
  }

  // Resolve aliases (e.g. "claude-3.5-sonnet" → "claude-3-5-sonnet-20241022")
  const requestedModel = resolveModelAlias(body.model);
  body.model = requestedModel;
  const isStream = body.stream === true;
  const clientRequestId = c.req.header("x-request-id") || randomUUID();

  // Route
  const route = selectRoute(requestedModel, metrics.routingStrategy);
  if (!route) {
    return c.json({
      error: { message: `No available provider for model: ${requestedModel}`, type: "server_error", code: "no_provider" },
    }, 503);
  }

  const { provider, model, isFallback } = route;
  // Update model in body to the routed model
  body.model = model;
  // For OpenAI-compatible streaming, request usage in the stream
  if (isStream && provider.format === "openai") {
    body.stream_options = { include_usage: true };
  }

  const startMs = performance.now();
  let res: Response;
  let retriedProvider: ProviderConfig | undefined;
  let retriedModel: string | undefined;

  try {
    res = await forward(provider, body);
  } catch (err) {
    metrics.markProviderDown(provider.name);
    const latencyMs = Math.round(performance.now() - startMs);
    recordRequest(requestedModel, model, provider.name, 0, 0, 0, latencyMs, "error");

    // Auto-retry with fallback provider
    if (!isFallback) {
      const fallback = selectRoute(requestedModel, "quality_first");
      if (fallback && fallback.provider.name !== provider.name) {
        try {
          body.model = fallback.model;
          if (isStream && fallback.provider.format === "openai") {
            body.stream_options = { include_usage: true };
          }
          res = await forward(fallback.provider, body);
          retriedProvider = fallback.provider;
          retriedModel = fallback.model;
        } catch {
          metrics.markProviderDown(fallback.provider.name);
        }
      }
    }
    if (!res!) {
      return c.json({
        error: { message: `Provider ${provider.name} unreachable`, type: "server_error" },
      }, 502);
    }
  }

  // Use retried provider info if retry succeeded
  const activeProvider = retriedProvider ?? provider;
  const activeModel = retriedModel ?? model;
  const activeIsFallback = !!retriedProvider || isFallback;

  if (!res!.ok) {
    const latencyMs = Math.round(performance.now() - startMs);
    const errBody = await res!.text().catch(() => "");
    const errStatus = res!.status;

    // Auto-retry on 5xx with a different provider
    if (errStatus >= 500 && !activeIsFallback) {
      metrics.markProviderDown(activeProvider.name);
      const fallback = selectRoute(requestedModel, "quality_first");
      if (fallback && fallback.provider.name !== activeProvider.name) {
        try {
          body.model = fallback.model;
          if (isStream && fallback.provider.format === "openai") {
            body.stream_options = { include_usage: true };
          }
          const retryRes = await forward(fallback.provider, body);
          if (retryRes.ok || retryRes.status < 500) {
            // Retry succeeded — continue with this response
            res = retryRes;
            Object.assign(route, { provider: fallback.provider, model: fallback.model, isFallback: true });
            // Fall through to normal response handling below
          } else {
            // Retry also failed
            recordRequest(requestedModel, activeModel, activeProvider.name, 0, 0, 0, latencyMs, "error");
            return c.json({
              error: {
                message: `Provider ${activeProvider.name} returned ${errStatus} (retry with ${fallback.provider.name} also failed)`,
                type: "upstream_error",
                upstream: errBody.slice(0, 500),
              },
            }, 502);
          }
        } catch {
          metrics.markProviderDown(fallback.provider.name);
          recordRequest(requestedModel, activeModel, activeProvider.name, 0, 0, 0, latencyMs, "error");
          return c.json({
            error: {
              message: `Provider ${activeProvider.name} returned ${errStatus}, fallback ${fallback.provider.name} unreachable`,
              type: "upstream_error",
            },
          }, 502);
        }
      } else {
        recordRequest(requestedModel, activeModel, activeProvider.name, 0, 0, 0, latencyMs, "error");
        return c.json({
          error: {
            message: `Provider ${activeProvider.name} returned ${errStatus}`,
            type: "upstream_error",
            upstream: errBody.slice(0, 500),
          },
        }, 502);
      }
    } else {
      recordRequest(requestedModel, activeModel, activeProvider.name, 0, 0, 0, latencyMs, "error");
      return c.json({
        error: {
          message: `Provider ${activeProvider.name} returned ${errStatus}`,
          type: "upstream_error",
          upstream: errBody.slice(0, 500),
        },
      }, (errStatus >= 500 ? 502 : errStatus) as 400 | 401 | 403 | 404 | 422 | 429 | 502);
    }
  }

  // Re-read provider/model after possible retry
  const finalProvider = route.provider;
  const finalModel = route.model;
  const finalIsFallback = route.isFallback;

  // ── Streaming response ──
  if (isStream && res!.body) {
    const latencyMs = Math.round(performance.now() - startMs);
    const routeboxStreamMeta = { model: finalModel, requestedModel, providerName: finalProvider.name };
    const stream = finalProvider.format === "anthropic"
      ? anthropicStreamToOpenAI(res!.body, finalModel, (usage) => {
          recordRequest(
            requestedModel, finalModel, finalProvider.name,
            usage.input, usage.output, usage.input + usage.output,
            latencyMs, finalIsFallback ? "fallback" : "success",
          );
        }, { requestedModel, providerName: finalProvider.name })
      : openaiStreamPassthrough(res!.body, (usage) => {
          recordRequest(
            requestedModel, finalModel, finalProvider.name,
            usage.input, usage.output, usage.input + usage.output,
            latencyMs, finalIsFallback ? "fallback" : "success",
          );
        }, routeboxStreamMeta);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-RouteBox-Provider": finalProvider.name,
        "X-RouteBox-Model": finalModel,
        "X-Request-ID": clientRequestId,
      },
    });
  }

  // ── Non-streaming response ──
  const latencyMs = Math.round(performance.now() - startMs);
  const json = await res!.json() as Record<string, unknown>;

  // Transform Anthropic response to OpenAI shape
  const responseJson = finalProvider.format === "anthropic"
    ? fromAnthropicResponse(json as never, finalModel)
    : json;

  const usage = extractUsage(json);
  const cost = calculateCost(finalModel, usage.input, usage.output, finalProvider.name);
  const originalCost = requestedModel !== finalModel
    ? calculateCost(requestedModel, usage.input, usage.output)
    : cost;

  recordRequest(
    requestedModel, finalModel, finalProvider.name,
    usage.input, usage.output, usage.input + usage.output,
    latencyMs, finalIsFallback ? "fallback" : "success",
  );

  // Inject _routebox metadata
  (responseJson as Record<string, unknown>)._routebox = {
    routed_model: finalModel,
    provider: finalProvider.name.toLowerCase(),
    cost,
    saved: Math.max(0, originalCost - cost),
    key_source: "byok",
  };

  return c.json(responseJson, 200, {
    "X-RouteBox-Provider": finalProvider.name,
    "X-RouteBox-Model": finalModel,
    "X-Request-ID": clientRequestId,
  });
});

// ── Record request in metrics ───────────────────────────────────────────────

function recordRequest(
  requestedModel: string,
  actualModel: string,
  providerName: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  latencyMs: number,
  status: RequestRecord["status"],
) {
  const cost = calculateCost(actualModel, inputTokens, outputTokens, providerName);
  metrics.record({
    id: randomUUID(),
    timestamp: Date.now(),
    provider: providerName,
    model: actualModel,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
    latencyMs,
    status,
    requestedModel,
    isFallback: status === "fallback",
    routingStrategy: metrics.routingStrategy,
  });

  // Calculate savings if routed to a cheaper model
  if (requestedModel !== actualModel && status !== "error") {
    const originalCost = calculateCost(requestedModel, inputTokens, outputTokens);
    if (originalCost > cost) {
      metrics.recordSaving(originalCost - cost);
    }
  }
}

export default app;
