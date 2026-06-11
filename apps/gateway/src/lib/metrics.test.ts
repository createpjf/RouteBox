import { test, expect } from "bun:test";
import { computeProviderUp, DOWN_FAIL_STREAK, PROVIDER_RECOVERY_MS } from "./metrics";

const T = 1_000_000; // 固定基准时间

test("healthy provider (failStreak below threshold) is up", () => {
  expect(computeProviderUp(0, 0, T)).toBe(true);
  expect(computeProviderUp(DOWN_FAIL_STREAK - 1, T, T)).toBe(true);
});

test("provider at/above fail threshold is down right after failure", () => {
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T)).toBe(false);
  expect(computeProviderUp(DOWN_FAIL_STREAK + 5, T, T)).toBe(false);
});

test("downed provider recovers (half-open) after recovery cooldown", () => {
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS - 1)).toBe(false);
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS)).toBe(true);
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS + 5000)).toBe(true);
});
