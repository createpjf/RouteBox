// ---------------------------------------------------------------------------
// Tests for quota module — Starter daily per-model limits
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach } from "bun:test";
import { checkDailyQuota, decrementDailyQuota, getUserQuotaUsage } from "./quota";

beforeEach(() => {
  // @ts-ignore
  globalThis.__dbMockSqlResults = [];
  // @ts-ignore
  globalThis.__dbMockSqlCalls = [];
});

// ── Pro / Max users always allowed ─────────────────────────────────────────

describe("checkDailyQuota — non-starter plans", () => {
  test("pro user is always allowed regardless of model", async () => {
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "pro");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  test("max user is always allowed regardless of model", async () => {
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "max");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  test("resetAt is tomorrow UTC 00:00 (not before now)", async () => {
    const before = new Date();
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "pro");
    const now = new Date();

    // resetAt must be after now
    expect(result.resetAt.getTime()).toBeGreaterThan(now.getTime());

    // resetAt must be UTC midnight of tomorrow (hours=0, mins=0, secs=0, ms=0)
    expect(result.resetAt.getUTCHours()).toBe(0);
    expect(result.resetAt.getUTCMinutes()).toBe(0);
    expect(result.resetAt.getUTCSeconds()).toBe(0);
    expect(result.resetAt.getUTCMilliseconds()).toBe(0);

    // Must be at most 25 hours from now (tomorrow midnight)
    const hoursUntilReset = (result.resetAt.getTime() - before.getTime()) / (1000 * 60 * 60);
    expect(hoursUntilReset).toBeLessThanOrEqual(25);
  });
});

// ── Starter user — non-restricted model ────────────────────────────────────

describe("checkDailyQuota — Starter, non-restricted model", () => {
  test("unknown-model gets conservative default quota for Starter (M1)", async () => {
    // Atomic upsert returns used_count=1 (first use)
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 1 }]];
    const result = await checkDailyQuota("user-1", "unknown-model-xyz", "starter");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // default limit 5, used 1
  });

  test("gpt-4o now has a quota for Starter (prefix match)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 1 }]];
    const result = await checkDailyQuota("user-1", "gpt-4o", "starter");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19); // limit 20, used 1
  });

  test("claude-3-5-sonnet now has a quota for Starter (prefix match)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 1 }]];
    const result = await checkDailyQuota("user-1", "claude-3-5-sonnet", "starter");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19); // limit 20, used 1
  });
});

// ── Starter user — kimi-k2.5 quota (limit = 50) ────────────────────────────

describe("checkDailyQuota — Starter, kimi-k2.5 (limit 50)", () => {
  test("first use → used_count=1 → allowed", async () => {
    // Atomic upsert returns used_count=1 after incrementing
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 1 }]];
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "starter");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(49);
  });

  test("used_count = 50 (at limit) → allowed (50th request)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 50 }]];
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "starter");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  test("used_count = 51 (over limit) → not allowed, decremented", async () => {
    // Atomic upsert returns 51 (over limit=50), then decrement is called
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 51 }], []]; // upsert result + decrement result
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "starter");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("resetAt is tomorrow UTC 00:00 (after now)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ used_count: 10 }]];
    const before = new Date();
    const result = await checkDailyQuota("user-1", "kimi-k2.5", "starter");

    expect(result.resetAt.getTime()).toBeGreaterThan(before.getTime());
    expect(result.resetAt.getUTCHours()).toBe(0);
    expect(result.resetAt.getUTCMinutes()).toBe(0);
    expect(result.resetAt.getUTCSeconds()).toBe(0);
  });
});

// ── decrementDailyQuota ──────────────────────────────────────────────────────

describe("decrementDailyQuota", () => {
  test("calls sql UPDATE to decrement", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    await decrementDailyQuota("user-1", "kimi-k2.5");
    // @ts-ignore
    const calls = globalThis.__dbMockSqlCalls as unknown[][];
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("user-1");
    expect(calls[0]).toContain("kimi-k2.5");
  });

  test("does not throw on empty result", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    await expect(decrementDailyQuota("user-1", "kimi-k2.5")).resolves.toBeUndefined();
  });
});

// ── getUserQuotaUsage ────────────────────────────────────────────────────────

describe("getUserQuotaUsage", () => {
  test("returns mapped quota usage rows", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [
        { model_id: "kimi-k2.5", used_count: 23 },
        { model_id: "kimi-k2", used_count: 15 },
      ],
    ];

    const result = await getUserQuotaUsage("user-1");
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe("kimi-k2.5");
    expect(result[0]!.used).toBe(23);
    expect(result[0]!.limit).toBe(50); // from STARTER_DAILY_QUOTA
    expect(result[1]!.model).toBe("kimi-k2");
    expect(result[1]!.used).toBe(15);
    expect(result[1]!.limit).toBe(30);
  });

  test("returns empty array when no usage today", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    const result = await getUserQuotaUsage("user-1");
    expect(result).toHaveLength(0);
  });

  test("limit is 0 for unknown model (not in STARTER_DAILY_QUOTA)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ model_id: "some-unknown-model", used_count: 5 }]];
    const result = await getUserQuotaUsage("user-1");
    expect(result[0]!.limit).toBe(0);
  });

  test("gpt-4o returns correct limit from STARTER_DAILY_QUOTA", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ model_id: "gpt-4o", used_count: 5 }]];
    const result = await getUserQuotaUsage("user-1");
    expect(result[0]!.limit).toBe(20);
  });
});
