// ---------------------------------------------------------------------------
// Test preload — unified mocks for db-cloud and polar (run before all tests)
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

// ── Unified db-cloud mock ─────────────────────────────────────────────────
// Each test file sets globalThis.__dbMockSqlResults / __dbMockTxResults to
// control what the mocked sql / withTx return. This avoids Bun's shared
// module-cache conflicts when multiple test files mock the same module.

// @ts-ignore
globalThis.__dbMockSqlResults = [] as unknown[];
// @ts-ignore
globalThis.__dbMockTxResults = [] as unknown[];
// @ts-ignore
globalThis.__dbMockSqlCalls = [] as unknown[][];

mock.module("./lib/db-cloud", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    // @ts-ignore
    (globalThis.__dbMockSqlCalls as unknown[][]).push(values);
    // @ts-ignore
    const result = (globalThis.__dbMockSqlResults as unknown[]).shift();
    if (result === undefined) {
      throw new Error(
        `sql() was called but no mock result is queued. ` +
        `Check test setup: add the missing entry to globalThis.__dbMockSqlResults.\n` +
        `Query params: ${JSON.stringify(values)}`
      );
    }
    return Promise.resolve(result);
  },
  withTx: async (fn: any) => {
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      // @ts-ignore
      const txResult = (globalThis.__dbMockTxResults as unknown[]).shift();
      if (txResult === undefined) {
        throw new Error(
          `tx() was called inside withTx but no mock tx result is queued. ` +
          `Check test setup: add the missing entry to globalThis.__dbMockTxResults.\n` +
          `Query params: ${JSON.stringify(values)}`
        );
      }
      return Promise.resolve(txResult);
    };
    return fn(tx);
  },
  initDatabase: async () => {},
}));

// ── Polar mock ────────────────────────────────────────────────────────────
mock.module("./lib/polar", () => ({
  getMarkupForPlan: () => 1.5,
}));

// ── Pre-load real modules ────────────────────────────────────────────────
// Load real modules (with mocked db-cloud) and save refs on globalThis so
// test files can access the real implementations even when other test files
// mock the module (e.g. credits-check.test.ts mocks ../lib/credits).

// Pre-load real modules and save individual function refs (NOT namespace objects)
// to avoid ESM live-binding issues when other test files mock the same module.
const _credits = await import("./lib/credits");
// @ts-ignore
globalThis.__realCredits = {
  getBalance: _credits.getBalance,
  getBalanceInfo: _credits.getBalanceInfo,
  deductCredits: _credits.deductCredits,
  addCredits: _credits.addCredits,
  addBonusCredits: _credits.addBonusCredits,
  recordCloudRequest: _credits.recordCloudRequest,
  getTransactions: _credits.getTransactions,
};
