# RouteBox Phase 3b — Ledger, Migration, Stats Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Phase 3 correctness fixes: make credit/bonus ledger idempotency race-safe, run cloud migrations under a transaction-scoped advisory lock, and make local gateway stats deltas stable across multiple readers.

**Architecture:** Keep each bug fix local to the owning module. Ledger idempotency is enforced by PostgreSQL partial unique indexes plus insert-claim flows in `credits.ts`; migration locking is wrapped in one transaction that owns `pg_advisory_xact_lock`; stats deltas are computed from fixed SQLite time windows instead of mutating read-time baselines.

**Tech Stack:** TypeScript + Bun tests; PostgreSQL via `postgres` in `apps/cloud-gateway`; SQLite via `bun:sqlite` in `apps/gateway`.

---

## Scope

**Included in Phase 3b:**
- **M6:** Payment and bonus idempotency correctness.
- **M2:** Transaction-scoped advisory migration lock.
- **M7-code:** Stable local gateway `getStats()` deltas for multiple WebSocket/API readers.

**Deferred:**
- UX Phase 4 and product Phase 5 items.
- Full webhook replay semantics beyond the ledger idempotency changes below.

## File Structure

| File | Responsibility | Operation |
|------|----------------|-----------|
| `apps/cloud-gateway/migrations/025_transaction_idempotency.sql` | Adds idempotency ledger columns/indexes | Create |
| `apps/cloud-gateway/src/lib/credits.ts` | Race-safe payment/bonus credit application | Modify |
| `apps/cloud-gateway/src/lib/credits.test.ts` | Ledger idempotency tests | Modify |
| `apps/cloud-gateway/src/test-setup.ts` | Adds transaction call observability for tests | Modify |
| `apps/cloud-gateway/src/lib/migration-runner.ts` | Testable transaction-scoped migration runner | Create |
| `apps/cloud-gateway/src/lib/migration-runner.test.ts` | Migration lock tests using a mocked SQL runner | Create |
| `apps/cloud-gateway/src/lib/db-cloud.ts` | Transaction-scoped migration lock runner | Modify |
| `apps/gateway/src/lib/db.ts` | Adds fixed-window aggregate query | Modify |
| `apps/gateway/src/lib/metrics.ts` | Uses DB windows for stats deltas, removes read-time baseline mutation | Modify |
| `apps/gateway/src/lib/metrics.test.ts` | Stable delta pure/unit regression tests | Modify |

**Execution notes:**
- Work on the current branch `fix/audit-remediation`; do not create or switch branches.
- Clean AppleDouble files before commits:

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
```

- Run cloud tests from `apps/cloud-gateway`; run local gateway tests from `apps/gateway`.
- `apps/cloud-gateway/bunfig.toml` preloads `src/test-setup.ts`, which mocks `./lib/db-cloud`. Keep the migration-lock helper in a separate `migration-runner.ts` file so tests can import real code without fighting that preload mock.

---

## Task 1: M6 — Race-Safe Transaction Idempotency Schema

**Files:**
- Create: `apps/cloud-gateway/migrations/025_transaction_idempotency.sql`
- Modify: `apps/cloud-gateway/src/lib/credits.test.ts`

- [ ] **Step 1: Write a migration existence/schema regression test**

Add this block near the top of `apps/cloud-gateway/src/lib/credits.test.ts` after `beforeEach()`:

```ts
// ── ledger idempotency migration ───────────────────────────────────────────

describe("transaction idempotency migration", () => {
  test("adds idempotency_key and unique partial indexes", async () => {
    const migration = await Bun.file(
      new URL("../../migrations/025_transaction_idempotency.sql", import.meta.url),
    ).text();

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS idempotency_key");
    expect(migration).toContain("idx_transactions_payment_ref_unique");
    expect(migration).toContain("WHERE payment_ref IS NOT NULL");
    expect(migration).toContain("idx_transactions_bonus_idempotency_unique");
    expect(migration).toContain("WHERE type = 'bonus' AND idempotency_key IS NOT NULL");
  });
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts -t "transaction idempotency migration"
```

Expected: FAIL because `025_transaction_idempotency.sql` does not exist.

- [ ] **Step 3: Add the idempotency migration**

Create `apps/cloud-gateway/migrations/025_transaction_idempotency.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Migration 025: Transaction idempotency hardening
-- ---------------------------------------------------------------------------

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Preserve historical payment references as idempotency keys where possible.
UPDATE transactions
SET idempotency_key = payment_ref
WHERE idempotency_key IS NULL
  AND payment_ref IS NOT NULL;

-- Prevent concurrent duplicate deposits for the same provider payment/session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_ref_unique
  ON transactions (payment_ref)
  WHERE payment_ref IS NOT NULL;

-- Prevent duplicate bonus application for the same user/reason key while still
-- allowing shared promo names across different users when callers choose that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bonus_idempotency_unique
  ON transactions (user_id, type, idempotency_key)
  WHERE type = 'bonus' AND idempotency_key IS NOT NULL;
```

- [ ] **Step 4: Run the migration test and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts -t "transaction idempotency migration"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/migrations/025_transaction_idempotency.sql apps/cloud-gateway/src/lib/credits.test.ts
git commit -m "fix(cloud): add transaction idempotency constraints"
```

---

## Task 2: M6 — Race-Safe `addCredits()` Deposit Idempotency

**Files:**
- Modify: `apps/cloud-gateway/src/lib/credits.ts`
- Modify: `apps/cloud-gateway/src/lib/credits.test.ts`
- Modify: `apps/cloud-gateway/src/test-setup.ts`

- [ ] **Step 1: Make transaction calls observable in the test setup**

In `apps/cloud-gateway/src/test-setup.ts`, add a global transaction call collector near the existing db mock globals:

```ts
// @ts-ignore
globalThis.__dbMockTxCalls = [] as unknown[][];
```

Inside the mocked `tx` function, before shifting `__dbMockTxResults`, record the bound values:

```ts
// @ts-ignore
(globalThis.__dbMockTxCalls as unknown[][]).push(values);
```

In `apps/cloud-gateway/src/lib/credits.test.ts` `beforeEach()`, reset it:

```ts
  // @ts-ignore
  globalThis.__dbMockTxCalls = [];
```

- [ ] **Step 2: Update the duplicate deposit test for insert-claim semantics**

Replace the existing `addCredits > returns existing balance for duplicate payment ref` mock setup with:

```ts
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [],                         // INSERT claim hit ON CONFLICT DO NOTHING
      [{ balance_cents: 1500 }],  // Current balance lookup
    ];
```

Keep the existing call and assertion:

```ts
    const newBalance = await credits.addCredits("user-1", 1000, "cs_duplicate");
    expect(newBalance).toBe(1500);
```

- [ ] **Step 3: Update the successful deposit test for insert-claim semantics**

Replace the existing `addCredits > adds credits and returns new balance` mock setup with:

```ts
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ id: "tx-claim" }],        // INSERT deposit claim
      [{ balance_cents: 2500 }],   // UPDATE credits RETURNING
      [],                          // UPDATE transaction balance_after_cents
    ];
```

After the balance assertion, add:

```ts
    // @ts-ignore
    const txCalls = globalThis.__dbMockTxCalls as unknown[][];
    expect(txCalls[0]).toContain("cs_test_123");
    expect(txCalls[2]).toContain("tx-claim");
    expect(txCalls[2]).toContain(2500);
```

- [ ] **Step 4: Run deposit tests and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts -t "addCredits"
```

Expected: FAIL because `addCredits()` still does select-before-update/insert and does not use the insert-claim flow.

- [ ] **Step 5: Implement race-safe `addCredits()`**

Replace the body of `addCredits()` in `apps/cloud-gateway/src/lib/credits.ts` with:

```ts
export async function addCredits(
  userId: string,
  amountCents: number,
  paymentRef: string,
  description?: string,
): Promise<number> {
  const result = await withTx(async (tx) => {
    const desc = description ?? "Credit purchase";

    const [claim] = await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents,
        description, payment_ref, idempotency_key)
      VALUES (${userId}, 'deposit', ${amountCents}, 0, ${desc}, ${paymentRef}, ${paymentRef})
      ON CONFLICT (payment_ref) WHERE payment_ref IS NOT NULL DO NOTHING
      RETURNING id
    `;

    if (!claim) {
      const [current] = await tx`
        SELECT balance_cents FROM credits WHERE user_id = ${userId}
      `;
      return (current?.balance_cents as number) ?? 0;
    }

    const [row] = await tx`
      UPDATE credits
      SET balance_cents = balance_cents + ${amountCents},
          total_deposited_cents = total_deposited_cents + ${amountCents},
          updated_at = now()
      WHERE user_id = ${userId}
      RETURNING balance_cents
    `;

    const newBalance = (row?.balance_cents as number) ?? 0;

    await tx`
      UPDATE transactions
      SET balance_after_cents = ${newBalance}
      WHERE id = ${claim.id}
    `;

    return newBalance;
  });

  return result;
}
```

- [ ] **Step 6: Run deposit tests and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts -t "addCredits"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/lib/credits.ts apps/cloud-gateway/src/lib/credits.test.ts apps/cloud-gateway/src/test-setup.ts
git commit -m "fix(cloud): make deposit crediting idempotent"
```

---

## Task 3: M6 — Race-Safe Bonus Idempotency

**Files:**
- Modify: `apps/cloud-gateway/src/lib/credits.ts`
- Modify: `apps/cloud-gateway/src/lib/credits.test.ts`

- [ ] **Step 1: Extend the local test type for idempotency keys**

In `apps/cloud-gateway/src/lib/credits.test.ts`, change the `addBonusCredits` type in `__realCredits` to:

```ts
  addBonusCredits: (userId: string, bonusCents: number, reason: string, idempotencyKey?: string) => Promise<number>;
```

- [ ] **Step 2: Add a duplicate bonus idempotency test**

Add this test inside `describe("addBonusCredits", ...)`:

```ts
  test("returns current total without applying duplicate idempotency key", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [],                                           // INSERT bonus claim hit conflict
      [{ balance_cents: 500, bonus_cents: 250 }],   // Current balance lookup
    ];

    const total = await credits.addBonusCredits(
      "user-1",
      100,
      "subscription_welcome",
      "sub_welcome_user-1_2026-06",
    );

    expect(total).toBe(750);

    // @ts-ignore
    const txCalls = globalThis.__dbMockTxCalls as unknown[][];
    expect(txCalls).toHaveLength(2);
    expect(txCalls[0]).toContain("sub_welcome_user-1_2026-06");
  });
```

- [ ] **Step 3: Add a new bonus claim test**

Add this test inside `describe("addBonusCredits", ...)`:

```ts
  test("stores idempotency key on new bonus transactions", async () => {
    // @ts-ignore
    globalThis.__dbMockTxResults = [
      [{ id: "bonus-tx" }],                         // INSERT bonus claim
      [{ balance_cents: 500, bonus_cents: 350 }],   // UPDATE credits RETURNING
      [],                                           // UPDATE transaction balance_after_cents
    ];

    const total = await credits.addBonusCredits(
      "user-1",
      100,
      "referral_welcome",
      "ref_welcome_user-1",
    );

    expect(total).toBe(850);

    // @ts-ignore
    const txCalls = globalThis.__dbMockTxCalls as unknown[][];
    expect(txCalls[0]).toContain("ref_welcome_user-1");
    expect(txCalls[2]).toContain("bonus-tx");
    expect(txCalls[2]).toContain(850);
  });
```

- [ ] **Step 4: Run bonus tests and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts -t "addBonusCredits"
```

Expected: FAIL because duplicate detection still uses `description LIKE` and no real `idempotency_key` column.

- [ ] **Step 5: Implement insert-claim bonus idempotency**

In `apps/cloud-gateway/src/lib/credits.ts`, replace the `idempotencyKey` branch at the start of `addBonusCredits()` with an insert-claim branch, and keep the existing non-idempotent path for calls without a key:

```ts
  const result = await withTx(async (tx) => {
    const descriptions: Record<string, string> = {
      referral_welcome: "Referral welcome bonus",
      referral_earning: "Referral earnings",
      subscription_welcome: "Subscription welcome credits",
      promo: "Promotional bonus",
    };
    const desc = descriptions[reason];

    if (idempotencyKey) {
      const [claim] = await tx`
        INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents,
          description, idempotency_key)
        VALUES (${userId}, 'bonus', ${bonusCents}, 0, ${desc}, ${idempotencyKey})
        ON CONFLICT (user_id, type, idempotency_key)
          WHERE type = 'bonus' AND idempotency_key IS NOT NULL
          DO NOTHING
        RETURNING id
      `;

      if (!claim) {
        const [current] = await tx`
          SELECT balance_cents, bonus_cents FROM credits WHERE user_id = ${userId}
        `;
        return ((current?.balance_cents as number) ?? 0) + ((current?.bonus_cents as number) ?? 0);
      }

      const [row] = await tx`
        UPDATE credits
        SET bonus_cents = bonus_cents + ${bonusCents},
            updated_at = now()
        WHERE user_id = ${userId}
        RETURNING balance_cents, bonus_cents
      `;

      const newBalance = (row?.balance_cents as number) ?? 0;
      const newBonus = (row?.bonus_cents as number) ?? 0;
      const total = newBalance + newBonus;

      await tx`
        UPDATE transactions
        SET balance_after_cents = ${total}
        WHERE id = ${claim.id}
      `;

      return total;
    }

    const [row] = await tx`
      UPDATE credits
      SET bonus_cents = bonus_cents + ${bonusCents},
          updated_at = now()
      WHERE user_id = ${userId}
      RETURNING balance_cents, bonus_cents
    `;

    const newBalance = (row?.balance_cents as number) ?? 0;
    const newBonus = (row?.bonus_cents as number) ?? 0;

    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (${userId}, 'bonus', ${bonusCents}, ${newBalance + newBonus}, ${desc})
    `;

    return newBalance + newBonus;
  });
```

Remove the old `description LIKE` duplicate check and the old ` [${idempotencyKey}]` suffix.

- [ ] **Step 6: Run credits tests and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/lib/credits.ts apps/cloud-gateway/src/lib/credits.test.ts
git commit -m "fix(cloud): make bonus crediting idempotent"
```

---

## Task 4: M2 — Transaction-Scoped Migration Advisory Lock

**Files:**
- Modify: `apps/cloud-gateway/src/lib/db-cloud.ts`
- Create: `apps/cloud-gateway/src/lib/migration-runner.ts`
- Create: `apps/cloud-gateway/src/lib/migration-runner.test.ts`

- [ ] **Step 1: Add a testable migration runner helper test**

Create `apps/cloud-gateway/src/lib/migration-runner.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { runMigrationsWithTransactionLock } from "./migration-runner";

describe("runMigrationsWithTransactionLock", () => {
  test("runs migrations under a transaction-scoped advisory lock", async () => {
    const events: string[] = [];
    const files = ["001.sql", "002.sql"];
    const contents: Record<string, string> = {
      "001.sql": "SELECT 1;",
      "002.sql": "SELECT 2;",
    };

    const sql = {
      begin: async (fn: (tx: any) => Promise<void>) => {
        events.push("begin");
        const tx = Object.assign(
          (strings: TemplateStringsArray) => {
            events.push(strings.join("?"));
            return Promise.resolve([{ locked: true }]);
          },
          {
            unsafe: async (statement: string) => {
              events.push(`unsafe:${statement}`);
              return [];
            },
          },
        );
        await fn(tx);
        events.push("commit");
      },
    };

    await runMigrationsWithTransactionLock(sql as any, {
      listFiles: () => files,
      readFile: (file) => contents[file]!,
      logApplied: (file) => events.push(`applied:${file}`),
    });

    expect(events).toEqual([
      "begin",
      "SELECT pg_advisory_xact_lock(1) AS locked",
      "unsafe:SELECT 1;",
      "applied:001.sql",
      "unsafe:SELECT 2;",
      "applied:002.sql",
      "commit",
    ]);
  });
});
```

- [ ] **Step 2: Run the migration-lock test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/migration-runner.test.ts
```

Expected: FAIL because `runMigrationsWithTransactionLock` is not exported.

- [ ] **Step 3: Add the transaction-lock helper**

Create `apps/cloud-gateway/src/lib/migration-runner.ts`:

```ts
export interface MigrationSources {
  listFiles: () => string[];
  readFile: (file: string) => string;
  logApplied?: (file: string) => void;
}

type MigrationTx = {
  (template: TemplateStringsArray, ...parameters: readonly unknown[]): Promise<unknown>;
  unsafe: (query: string) => Promise<unknown>;
};

export interface MigrationDb {
  begin: (fn: (tx: MigrationTx) => Promise<void>) => Promise<void>;
}

export async function runMigrationsWithTransactionLock(
  db: MigrationDb,
  sources: MigrationSources,
): Promise<void> {
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(1) AS locked`;

    for (const file of sources.listFiles()) {
      const migrationSql = sources.readFile(file);
      await tx.unsafe(migrationSql);
      sources.logApplied?.(file);
    }
  });
}
```

- [ ] **Step 4: Update `initDatabase()` to use the helper**

In `apps/cloud-gateway/src/lib/db-cloud.ts`, add:

```ts
import { runMigrationsWithTransactionLock } from "./migration-runner";
```

Then replace the existing session-lock block in `initDatabase()` with:

```ts
    await runMigrationsWithTransactionLock(sql as any, {
      listFiles: () => readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
      readFile: (file) => readFileSync(join(migrationsDir, file), "utf-8"),
      logApplied: (file) => log.info("migration_applied", { file }),
    });

    log.info("database_ready");
```

Remove the old `pg_try_advisory_lock`, wait, and manual unlock code.

- [ ] **Step 5: Run migration-lock test and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/migration-runner.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run cloud build-focused tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/migration-runner.test.ts src/lib/credits.test.ts
bun build src/lib/db-cloud.ts --target=bun --outdir=/tmp/cl-db-cloud-phase3b
```

Expected: PASS/build success.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/lib/db-cloud.ts apps/cloud-gateway/src/lib/migration-runner.ts apps/cloud-gateway/src/lib/migration-runner.test.ts
git commit -m "fix(cloud): use transaction-scoped migration lock"
```

---

## Task 5: M7-code — Stable Stats Deltas From Fixed DB Windows

**Files:**
- Modify: `apps/gateway/src/lib/db.ts`
- Modify: `apps/gateway/src/lib/metrics.ts`
- Modify: `apps/gateway/src/lib/metrics.test.ts`

- [ ] **Step 1: Add pure delta helper tests**

In `apps/gateway/src/lib/metrics.test.ts`, update the import:

```ts
import {
  calculateStatsDeltas,
  computeProviderUp,
  DOWN_FAIL_STREAK,
  PROVIDER_RECOVERY_MS,
} from "./metrics";
```

Add these tests after the provider recovery tests:

```ts
test("calculateStatsDeltas compares current and previous fixed windows", () => {
  expect(calculateStatsDeltas(
    { requests: 15, tokens: 300, cost: 6, avg_latency: 0 },
    { requests: 10, tokens: 200, cost: 4, avg_latency: 0 },
  )).toEqual({ requestsDelta: 50, tokensDelta: 50, costDelta: 50 });
});

test("calculateStatsDeltas is stable for repeated readers", () => {
  const current = { requests: 15, tokens: 300, cost: 6, avg_latency: 0 };
  const previous = { requests: 10, tokens: 200, cost: 4, avg_latency: 0 };

  const first = calculateStatsDeltas(current, previous);
  const second = calculateStatsDeltas(current, previous);

  expect(second).toEqual(first);
});

test("calculateStatsDeltas returns zero when previous window is empty", () => {
  expect(calculateStatsDeltas(
    { requests: 15, tokens: 300, cost: 6, avg_latency: 0 },
    { requests: 0, tokens: 0, cost: 0, avg_latency: 0 },
  )).toEqual({ requestsDelta: 0, tokensDelta: 0, costDelta: 0 });
});
```

- [ ] **Step 2: Run metrics helper tests and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/metrics.test.ts -t "calculateStatsDeltas"
```

Expected: FAIL because `calculateStatsDeltas` is not exported.

- [ ] **Step 3: Add fixed-window DB query**

In `apps/gateway/src/lib/db.ts`, add a prepared statement near `totalsStmt`:

```ts
const totalsBetweenStmt = db.prepare(`
  SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens,
         COALESCE(SUM(cost), 0) as cost, COALESCE(AVG(latency_ms), 0) as avg_latency
  FROM requests WHERE timestamp >= ? AND timestamp < ?
`);
```

Add this export after `queryTotals()`:

```ts
export function queryTotalsBetween(startTs: number, endTs: number): TotalsRow {
  const row = totalsBetweenStmt.get(startTs, endTs) as TotalsRow | null;
  return row ?? { requests: 0, tokens: 0, cost: 0, avg_latency: 0 };
}
```

- [ ] **Step 4: Update `metrics.ts` imports and add delta helper**

In `apps/gateway/src/lib/metrics.ts`, add `queryTotalsBetween` to the db import list and add `type TotalsRow`:

```ts
  queryTotalsBetween,
  type TotalsRow,
```

Add these constants/helpers near the other constants:

```ts
export const STATS_DELTA_WINDOW_MS = 5 * 60_000;

function percentDelta(current: number, previous: number): number {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
}

export function calculateStatsDeltas(current: TotalsRow, previous: TotalsRow) {
  return {
    requestsDelta: percentDelta(current.requests, previous.requests),
    tokensDelta: percentDelta(current.tokens, previous.tokens),
    costDelta: percentDelta(current.cost, previous.cost),
  };
}
```

Remove the three `prevRequests`, `prevTokens`, and `prevCost` fields and their constructor assignments.

- [ ] **Step 5: Replace read-mutating deltas in `getStats()`**

In `getStats()`, replace the existing `// Deltas` block that calculates deltas from `prev*` and then mutates `prev*` with:

```ts
    // Deltas — compare fixed DB windows so multiple stats readers do not
    // consume or reset each other's baseline.
    const deltaEnd = Date.now();
    const deltaStart = deltaEnd - STATS_DELTA_WINDOW_MS;
    const previousStart = deltaStart - STATS_DELTA_WINDOW_MS;
    const currentTotals = queryTotalsBetween(deltaStart, deltaEnd);
    const previousTotals = queryTotalsBetween(previousStart, deltaStart);
    const { requestsDelta, tokensDelta, costDelta } =
      calculateStatsDeltas(currentTotals, previousTotals);
```

Leave the returned field names unchanged.

- [ ] **Step 6: Run metrics tests and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/metrics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run local gateway build/test smoke**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/metrics.test.ts src/lib/db.test.ts
bun build src/lib/metrics.ts --target=bun --outdir=/tmp/gw-metrics-phase3b
```

Expected: PASS/build success.

- [ ] **Step 8: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/lib/db.ts apps/gateway/src/lib/metrics.ts apps/gateway/src/lib/metrics.test.ts
git commit -m "fix(gateway): compute stats deltas from fixed windows"
```

---

## Task 6: Final Verification

**Files:** no code changes unless verification reveals a bug.

- [ ] **Step 1: Clean AppleDouble files**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
```

- [ ] **Step 2: Run cloud ledger/migration tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/credits.test.ts src/lib/migration-runner.test.ts src/lib/referrals.test.ts src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run local gateway metrics/db tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/metrics.test.ts src/lib/db.test.ts
```

Expected: PASS.

- [ ] **Step 4: Build touched entry modules**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun build src/lib/credits.ts src/lib/db-cloud.ts --target=bun --outdir=/tmp/cl-phase3b

cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun build src/lib/metrics.ts --target=bun --outdir=/tmp/gw-phase3b
```

Expected: build success.

- [ ] **Step 5: Check git diff hygiene**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox
git diff --check 9bc3dbf..HEAD
git status --short --branch
```

Expected: no whitespace errors and clean working tree.
