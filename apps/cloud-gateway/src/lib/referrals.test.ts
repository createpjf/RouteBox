// ---------------------------------------------------------------------------
// Tests for referral system
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach } from "bun:test";

// db-cloud is mocked via test-setup.ts preload — use globalThis to control results.

const referrals = await import("./referrals");

beforeEach(() => {
  // @ts-ignore
  globalThis.__dbMockSqlResults = [];
  // @ts-ignore
  globalThis.__dbMockTxResults = [];
  // @ts-ignore
  globalThis.__dbMockSqlCalls = [];
});

// ── getOrCreateReferralCode ─────────────────────────────────────────────────

describe("getOrCreateReferralCode", () => {
  test("returns existing code if found", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ code: "ABC123", uses: 5 }],
      [{ count: 3 }],
    ];

    const result = await referrals.getOrCreateReferralCode("user-1");
    expect(result.code).toBe("ABC123");
    expect(result.uses).toBe(5);
    expect(result.totalRewardCents).toBe(600);
  });

  test("creates new code if none exists", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [],   // No existing
      [],   // No dup
      [],   // INSERT
    ];

    const result = await referrals.getOrCreateReferralCode("user-2");
    expect(result.code).toHaveLength(6);
    expect(result.uses).toBe(0);
    expect(result.totalRewardCents).toBe(0);
  });

  test("generated code uses valid characters only", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[], [], []];

    const result = await referrals.getOrCreateReferralCode("user-3");
    const validChars = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    expect(validChars.test(result.code)).toBe(true);
  });
});

// ── claimReferral ───────────────────────────────────────────────────────────

describe("claimReferral", () => {
  test("succeeds for valid referral code", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "ref-1", referrer_id: "user-a", uses: 0, max_uses: null }],
      [],   // No existing claim
      [],   // INSERT claim
      [],   // UPDATE referrals uses
      [],   // UPDATE users referred_by
    ];

    const result = await referrals.claimReferral("ABC123", "user-b");
    expect(result).toBe(true);
  });

  test("fails for non-existent code", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];

    const result = await referrals.claimReferral("INVALID", "user-b");
    expect(result).toBe(false);
  });

  test("fails for self-referral", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "ref-1", referrer_id: "user-a", uses: 0, max_uses: null }],
    ];

    const result = await referrals.claimReferral("ABC123", "user-a");
    expect(result).toBe(false);
  });

  test("fails if user already claimed a referral", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "ref-1", referrer_id: "user-a", uses: 0, max_uses: null }],
      [{ id: "existing-claim" }],
    ];

    const result = await referrals.claimReferral("ABC123", "user-c");
    expect(result).toBe(false);
  });

  test("fails if max uses reached", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "ref-1", referrer_id: "user-a", uses: 10, max_uses: 10 }],
    ];

    const result = await referrals.claimReferral("ABC123", "user-d");
    expect(result).toBe(false);
  });
});

// ── processReferralReward ───────────────────────────────────────────────────

describe("processReferralReward", () => {
  test("does nothing if no pending claim", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];

    await referrals.processReferralReward("user-x");
    // Should not throw
  });

  test("does nothing if deposit below minimum", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "claim-1", referral_id: "ref-1", referred_rewarded: false, referrer_rewarded: false, referrer_id: "user-a", reward_cents: 200 }],
      [{ total: 300 }],
    ];

    await referrals.processReferralReward("user-b");
  });
});
