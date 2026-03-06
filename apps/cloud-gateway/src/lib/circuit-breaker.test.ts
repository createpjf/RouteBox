// ---------------------------------------------------------------------------
// Tests for Circuit Breaker state machine
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { CircuitBreaker, getCircuitBreaker } from "./circuit-breaker";

describe("CircuitBreaker", () => {
  // ── Initial state ─────────────────────────────────────────────────────────

  test("starts in closed state", () => {
    const cb = new CircuitBreaker("test_init_1");
    expect(cb.getState()).toBe("closed");
  });

  test("canRequest returns true when closed", () => {
    const cb = new CircuitBreaker("test_init_2");
    expect(cb.canRequest()).toBe(true);
  });

  // ── Consecutive failure threshold ─────────────────────────────────────────

  test("stays closed after fewer than threshold failures", () => {
    const cb = new CircuitBreaker("test_consec_1", { failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.onFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);
  });

  test("opens after reaching consecutive failure threshold", () => {
    const cb = new CircuitBreaker("test_consec_2", { failureThreshold: 5 });
    for (let i = 0; i < 5; i++) cb.onFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);
  });

  test("custom failure threshold works", () => {
    const cb = new CircuitBreaker("test_consec_3", { failureThreshold: 2 });
    cb.onFailure();
    expect(cb.getState()).toBe("closed");
    cb.onFailure();
    expect(cb.getState()).toBe("open");
  });

  // ── Success resets consecutive failures ────────────────────────────────────

  test("onSuccess resets consecutive failure count", () => {
    const cb = new CircuitBreaker("test_reset_1", { failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.onFailure();
    cb.onSuccess(); // resets
    for (let i = 0; i < 4; i++) cb.onFailure();
    expect(cb.getState()).toBe("closed"); // 4 consecutive, not 5
  });

  // ── OPEN → HALF_OPEN transition ───────────────────────────────────────────

  test("transitions from open to half_open after recovery timeout", () => {
    const cb = new CircuitBreaker("test_recovery_1", {
      failureThreshold: 2,
      recoveryTimeoutMs: 1000,
    });

    let now = 10000;
    const spy = spyOn(Date, "now").mockImplementation(() => now);

    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("open");

    // Advance time by 999ms — still open
    now = 10999;
    expect(cb.getState()).toBe("open");

    // Advance time by 1000ms — half_open
    now = 11000;
    expect(cb.getState()).toBe("half_open");
    expect(cb.canRequest()).toBe(true);

    spy.mockRestore();
  });

  // ── HALF_OPEN behavior ────────────────────────────────────────────────────

  test("half_open transitions to closed on success", () => {
    const cb = new CircuitBreaker("test_half_1", {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
    });

    let now = 10000;
    const spy = spyOn(Date, "now").mockImplementation(() => now);

    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("open");

    now = 10100; // recovery timeout passed
    expect(cb.getState()).toBe("half_open");

    cb.onSuccess();
    expect(cb.getState()).toBe("closed");

    spy.mockRestore();
  });

  test("half_open transitions to open on failure", () => {
    const cb = new CircuitBreaker("test_half_2", {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
    });

    let now = 10000;
    const spy = spyOn(Date, "now").mockImplementation(() => now);

    cb.onFailure();
    cb.onFailure();
    now = 10100;
    expect(cb.getState()).toBe("half_open");

    cb.onFailure(); // back to open
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);

    spy.mockRestore();
  });

  // ── Failure rate threshold ────────────────────────────────────────────────

  test("opens when failure rate exceeds threshold", () => {
    const cb = new CircuitBreaker("test_rate_1", {
      failureThreshold: 100,       // high — won't trip by consecutive
      failureRateThreshold: 0.5,
      failureRateMinRequests: 10,
      windowMs: 60_000,
    });

    // 5 successes + 5 failures = 50% — doesn't trip (need > min requests first)
    // Let's do exactly 10 requests: 4 success + 6 failures = 60% failure
    for (let i = 0; i < 4; i++) cb.onSuccess();
    for (let i = 0; i < 6; i++) cb.onFailure();
    expect(cb.getState()).toBe("open");
  });

  test("does not trip on failure rate if below min requests", () => {
    const cb = new CircuitBreaker("test_rate_2", {
      failureThreshold: 100,
      failureRateThreshold: 0.5,
      failureRateMinRequests: 10,
      windowMs: 60_000,
    });

    // 9 requests total — below min
    for (let i = 0; i < 2; i++) cb.onSuccess();
    for (let i = 0; i < 7; i++) cb.onFailure();
    expect(cb.getState()).toBe("closed"); // only 9 requests, below minRequests
  });

  // ── Sliding window pruning ────────────────────────────────────────────────

  test("prunes outcomes outside the window", () => {
    const cb = new CircuitBreaker("test_prune_1", {
      failureThreshold: 100,
      failureRateThreshold: 0.5,
      failureRateMinRequests: 10,
      windowMs: 1000,
    });

    let now = 10000;
    const spy = spyOn(Date, "now").mockImplementation(() => now);

    // Add 8 failures at t=10000
    for (let i = 0; i < 8; i++) cb.onFailure();

    // Advance past the window
    now = 11500;

    // Add 10 successes — the old failures should be pruned
    for (let i = 0; i < 10; i++) cb.onSuccess();

    // Now add 3 failures — total in window: 10 success + 3 failure = 23% fail
    for (let i = 0; i < 3; i++) cb.onFailure();
    expect(cb.getState()).toBe("closed"); // 23% < 50%

    spy.mockRestore();
  });

  // ── Full lifecycle ────────────────────────────────────────────────────────

  test("full lifecycle: closed → open → half_open → closed", () => {
    const cb = new CircuitBreaker("test_lifecycle", {
      failureThreshold: 3,
      recoveryTimeoutMs: 500,
    });

    let now = 10000;
    const spy = spyOn(Date, "now").mockImplementation(() => now);

    expect(cb.getState()).toBe("closed");

    cb.onFailure();
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("open");

    now = 10500;
    expect(cb.getState()).toBe("half_open");

    cb.onSuccess();
    expect(cb.getState()).toBe("closed");

    spy.mockRestore();
  });
});

describe("getCircuitBreaker", () => {
  test("returns same instance for same id", () => {
    const cb1 = getCircuitBreaker("registry_test_1");
    const cb2 = getCircuitBreaker("registry_test_1");
    expect(cb1).toBe(cb2);
  });

  test("returns different instances for different ids", () => {
    const cb1 = getCircuitBreaker("registry_test_2");
    const cb2 = getCircuitBreaker("registry_test_3");
    expect(cb1).not.toBe(cb2);
  });

  test("applies custom config on first creation", () => {
    const cb = getCircuitBreaker("registry_test_4", { failureThreshold: 2 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe("open");
  });
});
