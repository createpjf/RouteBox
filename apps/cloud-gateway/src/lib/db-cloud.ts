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

export async function initDatabase() {
  try {
    const migrationsDir = join(import.meta.dir, "../../migrations");

    if (!existsSync(migrationsDir)) {
      // Migrations directory not present (e.g. inside Docker container).
      // Migrations are applied externally via deploy.sh — just verify connectivity.
      await sql`SELECT 1`;
      log.info("database_ready", { migrations: "skipped (dir not found)" });
      return;
    }

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // 001_init.sql, 002_phase2.sql, ...

    for (const file of files) {
      const migrationSql = readFileSync(join(migrationsDir, file), "utf-8");
      await sql.unsafe(migrationSql);
      log.info("migration_applied", { file });
    }
    log.info("database_ready");
  } catch (err) {
    log.error("migration_failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
