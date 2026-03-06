// ---------------------------------------------------------------------------
// Tests for key-pool: provider building, prefix matching, round-robin, CB sorting
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  buildCloudProviders,
  cloudProvidersForModel,
  cloudProviderForModel,
  initCloudProviders,
  cloudProviders,
} from "./key-pool";
import { getCircuitBreaker } from "./circuit-breaker";

// Save and restore env vars around each test
const savedEnv: Record<string, string | undefined> = {};

function saveAndClear() {
  const envKeys = [
    "OPENAI_API_KEY", "OPENAI_API_KEY_2", "OPENAI_API_KEY_3",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_2",
    "ANTHROPIC_BASE_URL",
    "GOOGLE_API_KEY", "GOOGLE_BASE_URL",
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
    "MINIMAX_API_KEY", "MINIMAX_BASE_URL",
    "KIMI_API_KEY", "KIMI_BASE_URL",
  ];
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("buildCloudProviders", () => {
  beforeEach(saveAndClear);
  afterEach(restoreEnv);

  test("returns empty array when no env vars set", () => {
    const providers = buildCloudProviders();
    expect(providers).toHaveLength(0);
  });

  test("builds single provider from single key", () => {
    process.env.OPENAI_API_KEY = "sk-test-1";
    const providers = buildCloudProviders();
    const openai = providers.filter((p) => p.name === "OpenAI");
    expect(openai).toHaveLength(1);
    expect(openai[0]!.apiKey).toBe("sk-test-1");
    expect(openai[0]!.instanceId).toBe("OpenAI:0");
  });

  test("builds multiple instances from multi-key", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    process.env.OPENAI_API_KEY_2 = "sk-2";
    process.env.OPENAI_API_KEY_3 = "sk-3";
    const providers = buildCloudProviders();
    const openai = providers.filter((p) => p.name === "OpenAI");
    expect(openai).toHaveLength(3);
    expect(openai[0]!.instanceId).toBe("OpenAI:0");
    expect(openai[1]!.instanceId).toBe("OpenAI:1");
    expect(openai[2]!.instanceId).toBe("OpenAI:2");
  });

  test("uses custom base URL from env", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    process.env.OPENAI_BASE_URL = "https://custom.api.com/v1";
    const providers = buildCloudProviders();
    expect(providers[0]!.baseUrl).toBe("https://custom.api.com/v1");
  });

  test("uses default base URL when env not set", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    const providers = buildCloudProviders();
    expect(providers[0]!.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("builds providers for multiple provider types", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic";
    process.env.GOOGLE_API_KEY = "sk-google";
    const providers = buildCloudProviders();
    const names = providers.map((p) => p.name);
    expect(names).toContain("OpenAI");
    expect(names).toContain("Anthropic");
    expect(names).toContain("Google");
  });

  test("sets correct format per provider", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    const providers = buildCloudProviders();
    const anthropic = providers.find((p) => p.name === "Anthropic");
    expect(anthropic!.format).toBe("anthropic");
  });
});

describe("cloudProvidersForModel", () => {
  beforeEach(() => {
    saveAndClear();
  });

  afterEach(restoreEnv);

  test("matches model by prefix", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    initCloudProviders();
    const providers = cloudProvidersForModel("gpt-4o");
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("OpenAI");
  });

  test("matches claude models to Anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    initCloudProviders();
    const providers = cloudProvidersForModel("claude-sonnet-4-20250514");
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("Anthropic");
  });

  test("returns empty array for unmatched model", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    initCloudProviders();
    const providers = cloudProvidersForModel("llama-3.1-70b");
    expect(providers).toHaveLength(0);
  });

  test("returns all instances for multi-key provider", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    process.env.OPENAI_API_KEY_2 = "sk-2";
    initCloudProviders();
    const providers = cloudProvidersForModel("gpt-4o-mini");
    expect(providers).toHaveLength(2);
  });

  test("round-robin rotates starting position", () => {
    process.env.OPENAI_API_KEY = "sk-a";
    process.env.OPENAI_API_KEY_2 = "sk-b";
    initCloudProviders();

    const first = cloudProvidersForModel("gpt-4o");
    const second = cloudProvidersForModel("gpt-4o");

    // First call starts at index 0, second at index 1
    expect(first[0]!.apiKey).not.toBe(second[0]!.apiKey);
  });

  test("sorts open circuit breakers last", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    process.env.OPENAI_API_KEY_2 = "sk-2";
    initCloudProviders();

    // Trip the first provider's circuit breaker (default threshold is 5)
    const cb = getCircuitBreaker("OpenAI:0");
    for (let i = 0; i < 5; i++) cb.onFailure();
    expect(cb.getState()).toBe("open");

    const providers = cloudProvidersForModel("gpt-4o");
    // OpenAI:0 (open) should be last
    expect(providers[providers.length - 1]!.instanceId).toBe("OpenAI:0");
  });
});

describe("cloudProviderForModel", () => {
  beforeEach(saveAndClear);
  afterEach(restoreEnv);

  test("returns first provider from chain", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    initCloudProviders();
    const provider = cloudProviderForModel("gpt-4o");
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("OpenAI");
  });

  test("returns undefined for unmatched model", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    initCloudProviders();
    const provider = cloudProviderForModel("llama-3.1-70b");
    expect(provider).toBeUndefined();
  });
});

describe("initCloudProviders", () => {
  beforeEach(saveAndClear);
  afterEach(restoreEnv);

  test("populates cloudProviders module variable", () => {
    process.env.OPENAI_API_KEY = "sk-1";
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    initCloudProviders();
    expect(cloudProviders.length).toBe(2);
  });
});
