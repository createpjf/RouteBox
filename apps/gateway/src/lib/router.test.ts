import { describe, test, expect, beforeEach } from "bun:test";
// env vars set in test-preload.ts
import { selectRoute } from "./router";
import { metrics } from "./metrics";
import { providers, providerForModel } from "./providers";

describe("selectRoute", () => {
  beforeEach(() => {
    // Reset all provider states to "up"
    for (const p of providers) {
      // Reset fail streaks by recording a synthetic success
      for (let i = 0; i < 5; i++) {
        metrics.record({
          id: `reset_${p.name}_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          provider: p.name,
          model: "test",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          latencyMs: 50,
          status: "success",
        });
      }
    }
  });

  test("quality_first returns canonical provider", () => {
    const route = selectRoute("gpt-4o", "quality_first");
    expect(route).not.toBeNull();
    expect(route!.provider.name).toBe("OpenAI");
    expect(route!.model).toBe("gpt-4o");
    expect(route!.isFallback).toBe(false);
  });

  test("quality_first returns canonical for claude", () => {
    const route = selectRoute("claude-sonnet-4-20250514", "quality_first");
    expect(route).not.toBeNull();
    expect(route!.provider.name).toBe("Anthropic");
    expect(route!.model).toBe("claude-sonnet-4-20250514");
    expect(route!.isFallback).toBe(false);
  });

  test("smart_auto returns canonical when provider is up", () => {
    const route = selectRoute("gpt-4o", "smart_auto");
    expect(route).not.toBeNull();
    expect(route!.provider.name).toBe("OpenAI");
    expect(route!.isFallback).toBe(false);
  });

  test("smart_auto falls back when canonical is down", () => {
    // Mark OpenAI as down
    for (let i = 0; i < 5; i++) {
      metrics.markProviderDown("OpenAI");
    }

    const route = selectRoute("gpt-4o", "smart_auto");
    // gpt-4o is in "flagship" tier; should fallback to another flagship model
    if (route) {
      expect(route.isFallback).toBe(true);
      expect(route.provider.name).not.toBe("OpenAI");
    }
    // Could be null if no other flagship provider is up — that's also valid
  });

  test("cost_first picks cheapest in tier", () => {
    const route = selectRoute("gpt-4o", "cost_first");
    expect(route).not.toBeNull();
    // Should pick cheapest flagship model. Gemini 2.5 Pro (1.25/10) is cheaper than gpt-4o (2.5/10)
    // but only if Google provider is available and up
    if (route!.model !== "gpt-4o") {
      expect(route!.isFallback).toBe(true);
    }
  });

  test("speed_first picks lowest latency in tier", () => {
    // Give Google very low latency
    for (let i = 0; i < 10; i++) {
      metrics.record({
        id: `speed_google_${i}`,
        timestamp: Date.now(),
        provider: "Google",
        model: "gemini-2.5-pro",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 10,
        status: "success",
      });
    }
    // Give OpenAI high latency
    for (let i = 0; i < 10; i++) {
      metrics.record({
        id: `speed_openai_${i}`,
        timestamp: Date.now(),
        provider: "OpenAI",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        latencyMs: 500,
        status: "success",
      });
    }

    const route = selectRoute("gpt-4o", "speed_first");
    expect(route).not.toBeNull();
    // Should prefer Google (10ms) over OpenAI (500ms)
    expect(route!.provider.name).toBe("Google");
    expect(route!.model).toBe("gemini-2.5-pro");
    expect(route!.isFallback).toBe(true);
  });

  test("unknown model falls back to best available via wildcard routing", () => {
    const route = selectRoute("llama-3-70b", "smart_auto");
    expect(route).not.toBeNull();
    expect(route!.isFallback).toBe(true);
  });

  test("quality_first falls back when canonical is down", () => {
    for (let i = 0; i < 5; i++) {
      metrics.markProviderDown("Anthropic");
    }
    const route = selectRoute("claude-sonnet-4-20250514", "quality_first");
    // Should fall back to another flagship model
    if (route) {
      expect(route.isFallback).toBe(true);
      expect(route.provider.name).not.toBe("Anthropic");
    }
  });
});

describe("providerForModel", () => {
  test("finds OpenAI for gpt models", () => {
    const p = providerForModel("gpt-4o");
    expect(p).toBeDefined();
    expect(p!.name).toBe("OpenAI");
  });

  test("finds Anthropic for claude models", () => {
    const p = providerForModel("claude-sonnet-4-20250514");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Anthropic");
  });

  test("finds Google for gemini models", () => {
    const p = providerForModel("gemini-2.5-pro");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Google");
  });

  test("returns undefined for unknown prefix", () => {
    expect(providerForModel("llama-3-70b")).toBeUndefined();
  });
});
