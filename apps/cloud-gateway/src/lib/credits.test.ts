// ---------------------------------------------------------------------------
// Tests for credits module (balance, deduct, add, record)
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeEach } from "bun:test";

// db-cloud is mocked via test-setup.ts preload — use globalThis to control results.
// Use preloaded real function refs to avoid ESM live-binding conflicts with
// credits-check.test.ts which mocks the credits module.
// @ts-ignore
const credits = globalThis.__realCredits as {
  getBalance: (userId: string) => Promise<number>;
  getBalanceInfo: (userId: string) => Promise<{ balance_cents: number; bonus_cents: number; total_cents: number }>;
  deductCredits: (userId: string, costCents: number, meta: any) => Promise<{ success: boolean; newBalance: number }>;
  addCredits: (userId: string, amountCents: number, paymentRef: string, description?: string) => Promise<number>;
  addBonusCredits: (userId: string, bonusCents: number, reason: string) => Promise<number>;
  recordCloudRequest: (...args: any[]) => Promise<void>;
  getTransactions: (userId: string, limit?: number, offset?: number) => Promise<any[]>;
};

beforeEach(() => {
  // @ts-ignore
  globalThis.__dbMockSqlResults = [];
  // @ts-ignore
  globalThis.__dbMockTxResults = [];
  // @ts-ignore
  globalThis.__dbMockSqlCalls = [];
});

// ── getBalance ──────────────────────────────────────────────────────────────

describe("getBalance", () => {
  test("returns balance when record exists", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ balance_cents: 1500 }]];
    const balance = await credits.getBalance("user-1");
    expect(balance).toBe(1500);
  });

  test("returns 0 when no record", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    const balance = await credits.getBalance("user-2");
    expect(balance).toBe(0);
  });
});

// ── deductCredits ───────────────────────────────────────────────────────────

describe("deductCredits", () => {
  test("succeeds when balance sufficient", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 1000 }], // SELECT FOR UPDATE
      [],                         // UPDATE credits
      [],                         // INSERT transaction
    ];

    const result = await credits.deductCredits("user-1", 300, {
      model: "gpt-4o",
      provider: "OpenAI",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(700);
  });

  test("fails when balance insufficient", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 100 }],
    ];

    const result = await credits.deductCredits("user-1", 500, {
      model: "gpt-4o",
      provider: "OpenAI",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(false);
    expect(result.newBalance).toBe(100);
  });

  test("fails when no credits row", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [[]];

    const result = await credits.deductCredits("user-new", 100, {
      model: "gpt-4o",
      provider: "OpenAI",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(false);
    expect(result.newBalance).toBe(0);
  });
});

// ── addCredits ──────────────────────────────────────────────────────────────

describe("addCredits", () => {
  test("adds credits and returns new balance", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [],                                // Check duplicate session
      [{ balance_cents: 2500 }],         // UPDATE RETURNING
      [],                                // INSERT transaction
    ];

    const newBalance = await credits.addCredits("user-1", 1000, "cs_test_123", "Top up");
    expect(newBalance).toBe(2500);
  });

  test("returns existing balance for duplicate payment ref", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ id: "existing-tx" }],
      [{ balance_cents: 1500 }],
    ];

    const newBalance = await credits.addCredits("user-1", 1000, "cs_duplicate");
    expect(newBalance).toBe(1500);
  });
});

// ── recordCloudRequest ──────────────────────────────────────────────────────

describe("recordCloudRequest", () => {
  test("calls sql insert", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    await credits.recordCloudRequest("user-1", "gpt-4o", "OpenAI", 100, 50, 5, 350, "200");
    // @ts-ignore
    const calls = globalThis.__dbMockSqlCalls as unknown[][];
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("user-1");
    expect(calls[0]).toContain("gpt-4o");
  });
});

// ── getBalanceInfo ───────────────────────────────────────────────────────────

describe("getBalanceInfo", () => {
  test("returns balance, bonus, and total", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[{ balance_cents: 500, bonus_cents: 200 }]];
    const info = await credits.getBalanceInfo("user-1");
    expect(info.balance_cents).toBe(500);
    expect(info.bonus_cents).toBe(200);
    expect(info.total_cents).toBe(700);
  });

  test("returns zeros when no record", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [[]];
    const info = await credits.getBalanceInfo("user-new");
    expect(info.balance_cents).toBe(0);
    expect(info.bonus_cents).toBe(0);
    expect(info.total_cents).toBe(0);
  });
});

// ── deductCredits — bonus priority ──────────────────────────────────────────

describe("deductCredits — bonus priority", () => {
  test("consumes bonus first, then balance (balance=100, bonus=50, cost=60)", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 100, bonus_cents: 50 }], // SELECT FOR UPDATE
      [],                                          // UPDATE credits
      [],                                          // INSERT transaction
    ];

    const result = await credits.deductCredits("user-1", 60, {
      model: "kimi-k2.5",
      provider: "Kimi",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(true);
    // deductBonus=50 (all of bonus), deductBalance=10 → newBalance=90
    expect(result.newBalance).toBe(90);
  });

  test("fails when total (balance+bonus) is insufficient", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 20, bonus_cents: 10 }], // total=30, cost=50
    ];

    const result = await credits.deductCredits("user-1", 50, {
      model: "kimi-k2.5",
      provider: "Kimi",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(false);
  });

  test("succeeds when only bonus covers cost (balance=0, bonus=200, cost=50)", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 0, bonus_cents: 200 }], // SELECT FOR UPDATE
      [],                                         // UPDATE credits
      [],                                         // INSERT transaction
    ];

    const result = await credits.deductCredits("user-1", 50, {
      model: "kimi-k2.5",
      provider: "Kimi",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0); // balance stays 0
  });
});

// ── addBonusCredits ─────────────────────────────────────────────────────────

describe("addBonusCredits", () => {
  test("balance_after_cents includes both balance and new bonus", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ balance_cents: 500, bonus_cents: 350 }], // UPDATE RETURNING (after adding 100 bonus)
      [],                                           // INSERT transaction
    ];

    const total = await credits.addBonusCredits("user-1", 100, "referral_welcome");
    // total = balance + bonus = 500 + 350 = 850
    expect(total).toBe(850);
  });
});

// ── getTransactions ─────────────────────────────────────────────────────────

describe("getTransactions", () => {
  test("maps row fields correctly", async () => {
    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [
        {
          id: "tx-1",
          type: "usage",
          amount_cents: -100,
          balance_after_cents: 900,
          description: "gpt-4o via OpenAI",
          model: "gpt-4o",
          input_tokens: 100,
          output_tokens: 50,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    ];

    const txs = await credits.getTransactions("user-1");
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amountCents).toBe(-100);
    expect(txs[0]!.model).toBe("gpt-4o");
    expect(txs[0]!.inputTokens).toBe(100);
  });
});
