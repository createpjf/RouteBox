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
      [{ total: 600 }],  // SUM(earning_cents) from referral_earnings
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

// ── processReferralReward / claimReferralWelcome ────────────────────────────

describe("processReferralReward / claimReferralWelcome", () => {
  test("does nothing if no pending claim", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];

    await referrals.processReferralReward("user-x");
    // Should not throw
  });

  test("does nothing if deposit below minimum ($5)", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "claim-1", referral_id: "ref-1", referred_rewarded: false,
         welcome_bonus_cents: 300, referrer_id: "user-a" }],
      [{ total: 300 }],  // $3 deposit — below $5 threshold
    ];

    await referrals.processReferralReward("user-b");
    // Should not throw, no credits issued
  });

  test("issues welcome bonus when deposit >= $5 (success path, atomic transaction)", async () => {
    // SQL calls: 1) SELECT claim, 2) SELECT deposits
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "claim-1", referral_id: "ref-1", referred_rewarded: false,
         welcome_bonus_cents: 300, referrer_id: "user-a" }],
      [{ total: 600 }],  // $6 deposit — above $5 threshold
    ];
    // TX calls (in withTx): 1) UPDATE referral_claims RETURNING id, 2) UPDATE credits RETURNING, 3) INSERT transaction
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ id: "claim-1" }],                         // UPDATE referral_claims ... RETURNING id (row updated)
      [{ balance_cents: 0, bonus_cents: 300 }],   // UPDATE credits RETURNING
      [],                                          // INSERT transactions
    ];

    await referrals.processReferralReward("user-b");
    // @ts-ignore
    const sqlCalls = globalThis.__dbMockSqlCalls as unknown[][];
    expect(sqlCalls.length).toBe(2); // Only 2 outer SQL calls (claim + deposits)
    // No throw = transaction completed atomically
  });
});

  test("skips bonus when concurrent call already processed (UPDATE returns no row)", async () => {
    // Simulates a race condition: two calls read referred_rewarded=false before the tx,
    // but the second call's UPDATE finds referred_rewarded=true already (0 rows returned).
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ id: "claim-1", referral_id: "ref-1", referred_rewarded: false,
         welcome_bonus_cents: 300, referrer_id: "user-a" }],  // SELECT claim
      [{ total: 600 }],                                         // SELECT deposits >= $5
    ];
    // TX: UPDATE returns no row (another call already set referred_rewarded=true)
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [],  // UPDATE referral_claims RETURNING id — 0 rows (already processed)
    ];

    await referrals.processReferralReward("user-b");
    // @ts-ignore
    const sqlCalls = globalThis.__dbMockSqlCalls as unknown[][];
    expect(sqlCalls.length).toBe(2); // Only outer SQL calls (claim + deposits), no credits issued
  });

// ── processMonthlyReferralEarnings ──────────────────────────────────────────

describe("processMonthlyReferralEarnings", () => {
  test("processes earnings for a valid referral and issues bonus", async () => {
    const periodMonth = "2026-03";

    // SQL calls:
    // 1) SELECT referral claims (cutoff query)
    // 2) SELECT existing referral_earnings (for claim-1/user-a/user-b)
    // 3) SELECT API spend for referred user
    // 4) INSERT referral_earnings RETURNING id
    // 5) addBonusCredits → uses withTx internally
    // 6) UPDATE referrals total_earned_cents
    // 7) UPDATE referral_earnings is_paid
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      // 1. Active referral claims
      [{ claim_id: "c1", referred_user_id: "user-b", referrer_id: "user-a",
         revenue_share_pct: 10, revenue_share_months: 3, created_at: new Date("2026-01-01") }],
      // 2. No existing earnings for this period
      [],
      // 3. API spend: $100 = 10000 cents
      [{ total: 10000 }],
      // 4. INSERT returns id (was actually inserted)
      [{ id: "earn-1" }],
      // 6. UPDATE referrals
      [],
      // 7. UPDATE referral_earnings is_paid
      [],
    ];
    // addBonusCredits withTx calls (5):
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 0, bonus_cents: 1000 }], // UPDATE credits RETURNING
      [],                                          // INSERT transactions
    ];

    const result = await referrals.processMonthlyReferralEarnings(periodMonth);
    expect(result.processed).toBe(1);
    expect(result.totalEarningCents).toBe(1000); // 10% of 10000
  });

  test("skips already-processed earnings for the period (RETURNING returns nothing)", async () => {
    const periodMonth = "2026-03";
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      // 1. Active referral claims
      [{ claim_id: "c1", referred_user_id: "user-b", referrer_id: "user-a",
         revenue_share_pct: 10, revenue_share_months: 3, created_at: new Date("2026-01-01") }],
      // 2. No existing earnings (passes early check)
      [],
      // 3. API spend
      [{ total: 5000 }],
      // 4. INSERT ON CONFLICT DO NOTHING — returns nothing (conflict, already inserted by concurrent call)
      [],
    ];

    const result = await referrals.processMonthlyReferralEarnings(periodMonth);
    // Should have skipped processing (INSERT returned no row = conflict)
    expect(result.processed).toBe(0);
    expect(result.totalEarningCents).toBe(0);
  });

  test("skips claims where apiSpendCents is 0", async () => {
    const periodMonth = "2026-03";
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [{ claim_id: "c1", referred_user_id: "user-b", referrer_id: "user-a",
         revenue_share_pct: 10, revenue_share_months: 3, created_at: new Date("2026-01-01") }],
      [],               // No existing earnings
      [{ total: 0 }],  // Zero API spend → skip
    ];

    const result = await referrals.processMonthlyReferralEarnings(periodMonth);
    expect(result.processed).toBe(0);
  });

  test("returns 0 processed when no active referral claims", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]]; // No claims at all
    const result = await referrals.processMonthlyReferralEarnings("2026-03");
    expect(result.processed).toBe(0);
    expect(result.totalEarningCents).toBe(0);
  });
});
