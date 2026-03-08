// ---------------------------------------------------------------------------
// PostgreSQL connection + migration runner
// ---------------------------------------------------------------------------

import postgres from "postgres";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://routebox:routebox@localhost:5432/routebox";

export const sql = postgres(DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  ssl: process.env.DATABASE_SSL === "true" ? "require" : false,
});

/**
 * Tagged-template callable type for transactions.
 * Workaround: postgres.js TransactionSql extends Omit<Sql, ...> which
 * drops the tagged-template call signatures.
 */
type SqlQuery = {
  <T extends readonly any[] = postgres.Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly any[]
  ): postgres.PendingQuery<T>;
};

/** Typed transaction helper */
export function withTx<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sql.begin(fn as any) as any;
}

/** Lightweight DB connectivity check for /health endpoint */
export async function checkDbHealth(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function waitForDb(maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (err) {
      const delay = Math.pow(2, i) * 1000;
      log.warn("db_connect_retry", {
        attempt: i + 1,
        maxRetries,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      if (i === maxRetries - 1) {
        throw new Error(`Database unreachable after ${maxRetries} attempts`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function initDatabase() {
  await waitForDb();

  try {
    const migrationsDir = join(import.meta.dir, "../../migrations");

    if (!existsSync(migrationsDir)) {
      log.info("database_ready", { migrations: "skipped (dir not found)" });
      return;
    }

    // Acquire advisory lock to prevent concurrent migration runs
    const [lock] = await sql`SELECT pg_try_advisory_lock(1) AS acquired`;
    if (!lock?.acquired) {
      log.info("migration_skipped", { reason: "another instance is running migrations" });
      await sql`SELECT pg_advisory_lock(1)`;
      await sql`SELECT pg_advisory_unlock(1)`;
      return;
    }

    try {
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const file of files) {
        const migrationSql = readFileSync(join(migrationsDir, file), "utf-8");
        await sql.unsafe(migrationSql);
        log.info("migration_applied", { file });
      }
      log.info("database_ready");
    } finally {
      await sql`SELECT pg_advisory_unlock(1)`;
    }
  } catch (err) {
    log.error("migration_failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
