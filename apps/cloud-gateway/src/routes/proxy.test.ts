// ---------------------------------------------------------------------------
// Tests for proxy pure utility functions
// ---------------------------------------------------------------------------

import { describe, test, expect, spyOn } from "bun:test";

// db-cloud and polar are mocked via test-setup.ts preload.
// No per-file mocks needed — pure functions don't hit the database.

const {
  resolveAlias,
  pricingFor,
  calculateCost,
  calculateUserCostCents,
  isRetryableStatus,
  backoff,
} = await import("./proxy");

// ── resolveAlias ────────────────────────────────────────────────────────────

describe("resolveAlias", () => {
  test("returns original model if no alias", () => {
    expect(resolveAlias("minimax-m2.5")).toBe("minimax-m2.5");
  });

  test("returns unknown model unchanged", () => {
    expect(resolveAlias("some-unknown-model")).toBe("some-unknown-model");
  });
});

// ── pricingFor ──────────────────────────────────────────────────────────────

describe("pricingFor", () => {
  test("returns exact match pricing for minimax", () => {
    const p = pricingFor("minimax-m2.5");
    expect(p.input).toBe(0.30);
    expect(p.output).toBe(1.20);
  });

  test("returns pricing for openrouter model", () => {
    const p = pricingFor("openrouter/anthropic/claude-sonnet-4.6");
    expect(p.input).toBe(3.00);
    expect(p.output).toBe(15.00);
  });

  test("returns default pricing for unknown model", () => {
    const p = pricingFor("totally-unknown-model");
    expect(p.input).toBe(1);
    expect(p.output).toBe(3);
  });

  test("returns pricing for kimi model", () => {
    const p = pricingFor("kimi-k2.5");
    expect(p.input).toBe(0.60);
    expect(p.output).toBe(3.00);
  });
});

// ── calculateCost ───────────────────────────────────────────────────────────

describe("calculateCost", () => {
  test("calculates cost for known model", () => {
    // kimi-k2.5: input=$0.60/M, output=$3.00/M
    const cost = calculateCost("kimi-k2.5", 1000, 500);
    // (1000 * 0.60 + 500 * 3.00) / 1_000_000 = 0.0021
    expect(cost).toBeCloseTo(0.0021);
  });

  test("returns 0 for zero tokens", () => {
    expect(calculateCost("minimax-m2.1", 0, 0)).toBe(0);
  });

  test("uses default pricing for unknown model", () => {
    const cost = calculateCost("unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(4); // 1 + 3
  });
});

// ── calculateUserCostCents ──────────────────────────────────────────────────

describe("calculateUserCostCents", () => {
  test("applies markup and returns cents", () => {
    // gpt-4o: $2.5 input + $10 output = $12.5/M each, × 1.5 markup = $18.75/M → 1875¢
    const cents = calculateUserCostCents(1_000_000, 1_000_000, { input: 2.5, output: 10, markup: 1.5 });
    expect(cents).toBe(1875);
  });

  test("rounds up to at least 1 cent", () => {
    const cents = calculateUserCostCents(1, 1, { input: 0.15, output: 0.6, markup: 1.0 });
    expect(cents).toBeGreaterThanOrEqual(1);
  });

  test("with no markup (1.0x)", () => {
    // gpt-4o: $2.5/M input × 1M tokens × 1.0 markup = $2.50 = 250¢
    const cents = calculateUserCostCents(1_000_000, 0, { input: 2.5, output: 10, markup: 1.0 });
    expect(cents).toBe(250);
  });

  test("discount model: uses registry price directly (markup=1.0)", () => {
    // kimi-k2.5 user price: $0.90/M input, $2.70/M output
    const cents = calculateUserCostCents(1_000_000, 1_000_000, { input: 0.90, output: 2.70, markup: 1.0 });
    expect(cents).toBe(360); // (0.90 + 2.70) = $3.60 = 360¢
  });
});

// ── isRetryableStatus ───────────────────────────────────────────────────────

describe("isRetryableStatus", () => {
  test("500 is retryable", () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  test("502 is retryable", () => {
    expect(isRetryableStatus(502)).toBe(true);
  });

  test("503 is retryable", () => {
    expect(isRetryableStatus(503)).toBe(true);
  });

  test("529 is retryable", () => {
    expect(isRetryableStatus(529)).toBe(true);
  });

  test("400 is not retryable", () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  test("401 is not retryable", () => {
    expect(isRetryableStatus(401)).toBe(false);
  });

  test("404 is not retryable", () => {
    expect(isRetryableStatus(404)).toBe(false);
  });

  test("422 is not retryable", () => {
    expect(isRetryableStatus(422)).toBe(false);
  });

  test("200 is not retryable", () => {
    expect(isRetryableStatus(200)).toBe(false);
  });
});

// ── backoff ─────────────────────────────────────────────────────────────────

describe("backoff", () => {
  test("delay formula: BASE * 2^attempt + jitter", async () => {
    const randomSpy = spyOn(Math, "random").mockReturnValue(0.5);

    let capturedDelay = 0;
    const origSetTimeout = globalThis.setTimeout;
    // @ts-ignore — override to capture delay and resolve immediately
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      capturedDelay = ms;
      fn();
      return 0;
    };

    await backoff(0);
    // BASE_DELAY_MS=200, attempt=0: 200 * 2^0 + 0.5*100 = 250
    expect(capturedDelay).toBe(250);

    await backoff(1);
    // 200 * 2^1 + 0.5*100 = 450
    expect(capturedDelay).toBe(450);

    await backoff(2);
    // 200 * 2^2 + 0.5*100 = 850
    expect(capturedDelay).toBe(850);

    globalThis.setTimeout = origSetTimeout;
    randomSpy.mockRestore();
  });
});
