// ---------------------------------------------------------------------------
// Provider API key validation — lightweight check per provider type
// ---------------------------------------------------------------------------

import type { ProviderTemplate } from "./providers";

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Validate an API key for a given provider template */
export async function validateProviderKey(
  template: ProviderTemplate,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidationResult> {
  const url = baseUrl || template.defaultBaseUrl;

  try {
    if (template.format === "anthropic") {
      // Anthropic: POST /messages with minimal body
      // 401 = bad key, 400 = valid key (missing required fields)
      const res = await fetchWithTimeout(`${url}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: "claude-haiku-4-20250514", max_tokens: 1, messages: [] }),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid API key" };
      }
      // 400 means the key is valid but the request body is wrong — that's fine
      if (res.status === 400 || res.ok) {
        return { ok: true };
      }
      return { ok: false, error: `Unexpected status: ${res.status}` };
    }

    if (template.name === "Google") {
      // Google: GET /models with key param
      const res = await fetchWithTimeout(
        `${url}/models?key=${apiKey}`,
        { method: "GET" },
      );
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        return { ok: false, error: "Invalid API key" };
      }
      if (res.ok) return { ok: true };
      return { ok: false, error: `Unexpected status: ${res.status}` };
    }

    // OpenAI-compatible providers
    const headers: Record<string, string> = {};
    if (template.authHeader) {
      headers[template.authHeader] = apiKey;
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (template.name === "MiniMax") {
      // MiniMax doesn't support GET /models — validate via POST /chat/completions
      // with a minimal body. 401/403 = bad key, 400/422 = valid key (bad request body)
      headers["Content-Type"] = "application/json";
      const res = await fetchWithTimeout(`${url}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "MiniMax-M2.1", max_tokens: 1, messages: [] }),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid API key" };
      }
      if (res.status === 400 || res.status === 422 || res.ok) {
        return { ok: true };
      }
      return { ok: false, error: `Unexpected status: ${res.status}` };
    }

    // Other OpenAI-compatible (OpenAI, DeepSeek, Kimi, FLock.io): GET /models
    const res = await fetchWithTimeout(`${url}/models`, {
      method: "GET",
      headers,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Invalid API key" };
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `Unexpected status: ${res.status}` };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Validation timed out" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
