import { test, expect } from "bun:test";
import { pricingForModel, calculateCost } from "./pricing";
import type { ModelPricing } from "./types";

const TABLE: Record<string, ModelPricing> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
};

test("exact table hit", () => {
  expect(pricingForModel("gpt-4o", TABLE)).toEqual({ input: 2.5, output: 10 });
});
test("prefix match (longest key that prefixes the model)", () => {
  expect(pricingForModel("gpt-4o-2024-08-06", TABLE)).toEqual({ input: 2.5, output: 10 });
});
test("default fallback {1,3} when no match", () => {
  expect(pricingForModel("totally-unknown", TABLE)).toEqual({ input: 1, output: 3 });
});
test("custom fallback honored", () => {
  expect(pricingForModel("unknown", TABLE, { fallback: { input: 0.5, output: 0.5 } }))
    .toEqual({ input: 0.5, output: 0.5 });
});
test("free providers short-circuit to zero", () => {
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "Ollama", freeProviders: ["Ollama", "LM Studio"] }))
    .toEqual({ input: 0, output: 0 });
});
test("provider-specific override beats table", () => {
  const overrides = { "FLock.io": { "gpt-4o": { input: 9, output: 9 } } };
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "FLock.io", providerOverrides: overrides }))
    .toEqual({ input: 9, output: 9 });
});
test("override only applies to the named provider", () => {
  const overrides = { "FLock.io": { "gpt-4o": { input: 9, output: 9 } } };
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "OpenAI", providerOverrides: overrides }))
    .toEqual({ input: 2.5, output: 10 });
});
test("calculateCost uses (in*input + out*output)/1e6", () => {
  expect(calculateCost("gpt-4o", 1000, 2000, TABLE)).toBeCloseTo(0.0225, 10);
});
test("reduces to cloud behavior (no opts): exact then prefix then {1,3}", () => {
  expect(pricingForModel("claude-sonnet-4-20250514", TABLE)).toEqual({ input: 3, output: 15 });
  expect(pricingForModel("nope", TABLE)).toEqual({ input: 1, output: 3 });
});
