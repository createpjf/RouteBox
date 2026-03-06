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
  test("resolves known alias", () => {
    expect(resolveAlias("claude-sonnet")).toBe("claude-sonnet-4-20250514");
  });

  test("resolves gpt alias", () => {
    expect(resolveAlias("gpt-4o-latest")).toBe("gpt-4o");
  });

  test("resolves gemini alias", () => {
    expect(resolveAlias("gemini-pro")).toBe("gemini-2.5-pro");
  });

  test("returns original model if no alias", () => {
    expect(resolveAlias("gpt-4o")).toBe("gpt-4o");
  });

  test("returns unknown model unchanged", () => {
    expect(resolveAlias("some-unknown-model")).toBe("some-unknown-model");
  });
});

// ── pricingFor ──────────────────────────────────────────────────────────────

describe("pricingFor", () => {
  test("returns exact match pricing", () => {
    const p = pricingFor("gpt-4o");
    expect(p.input).toBe(2.5);
    expect(p.output).toBe(10);
  });

  test("returns pricing for claude model", () => {
    const p = pricingFor("claude-sonnet-4-20250514");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  test("returns default pricing for unknown model", () => {
    const p = pricingFor("totally-unknown-model");
    expect(p.input).toBe(1);
    expect(p.output).toBe(3);
  });

  test("uses prefix match for versioned models", () => {
    const p = pricingFor("deepseek-chat");
    expect(p.input).toBe(0.27);
  });
});

// ── calculateCost ───────────────────────────────────────────────────────────

describe("calculateCost", () => {
  test("calculates cost for known model", () => {
    // gpt-4o: input=$2.50/M, output=$10/M
    const cost = calculateCost("gpt-4o", 1000, 500);
    expect(cost).toBeCloseTo(0.0075);
  });

  test("returns 0 for zero tokens", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });

  test("uses default pricing for unknown model", () => {
    const cost = calculateCost("unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(4); // 1 + 3
  });
});

// ── calculateUserCostCents ──────────────────────────────────────────────────

describe("calculateUserCostCents", () => {
  test("applies markup and returns cents", () => {
    const cents = calculateUserCostCents("gpt-4o", 1_000_000, 1_000_000, 1.5);
    expect(cents).toBe(1875);
  });

  test("rounds up to at least 1 cent", () => {
    const cents = calculateUserCostCents("gpt-4o-mini", 1, 1, 1.0);
    expect(cents).toBeGreaterThanOrEqual(1);
  });

  test("with no markup (1.0x)", () => {
    const cents = calculateUserCostCents("gpt-4o", 1_000_000, 0, 1.0);
    expect(cents).toBe(250);
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
