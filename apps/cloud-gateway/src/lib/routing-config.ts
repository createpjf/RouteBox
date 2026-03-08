// ---------------------------------------------------------------------------
// Routing configuration — DB-backed global default + per-user overrides
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";
import { log } from "./logger";

export const VALID_STRATEGIES = [
  "smart_auto",
  "cost_first",
  "speed_first",
  "quality_first",
] as const;

export type RoutingStrategy = (typeof VALID_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let globalStrategy: string = "smart_auto";
let userOverrides = new Map<string, string>(); // userId → strategy

// ---------------------------------------------------------------------------
// DB CRUD
// ---------------------------------------------------------------------------

/** Load both global strategy and per-user overrides into memory cache */
export async function loadRoutingConfig(): Promise<void> {
  // Load global default
  const [row] = await sql`SELECT default_strategy FROM routing_config WHERE id = 1`;
  if (row) {
    globalStrategy = row.default_strategy as string;
  }

  // Load per-user overrides
  const rows = await sql`SELECT user_id, strategy FROM user_routing_override`;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.user_id as string, r.strategy as string);
  }
  userOverrides = map;

  log.info("routing_config_loaded", {
    defaultStrategy: globalStrategy,
    overrideCount: map.size,
  });
}

export async function getGlobalStrategy(): Promise<string> {
  const [row] = await sql`SELECT default_strategy FROM routing_config WHERE id = 1`;
  return (row?.default_strategy as string) ?? "smart_auto";
}

export async function setGlobalStrategy(strategy: string): Promise<void> {
  await sql`
    UPDATE routing_config
    SET default_strategy = ${strategy}, updated_at = now()
    WHERE id = 1
  `;
  globalStrategy = strategy;
}

export async function getUserOverrides(): Promise<
  { userId: string; strategy: string; email: string }[]
> {
  const rows = await sql`
    SELECT uro.user_id, uro.strategy, u.email
    FROM user_routing_override uro
    JOIN users u ON u.id = uro.user_id
    ORDER BY u.email
  `;
  return rows.map((r) => ({
    userId: r.user_id as string,
    strategy: r.strategy as string,
    email: r.email as string,
  }));
}

export async function setUserOverride(
  userId: string,
  strategy: string,
): Promise<void> {
  await sql`
    INSERT INTO user_routing_override (user_id, strategy, updated_at)
    VALUES (${userId}, ${strategy}, now())
    ON CONFLICT (user_id) DO UPDATE
    SET strategy = ${strategy}, updated_at = now()
  `;
  userOverrides.set(userId, strategy);
}

export async function removeUserOverride(userId: string): Promise<void> {
  await sql`DELETE FROM user_routing_override WHERE user_id = ${userId}`;
  userOverrides.delete(userId);
}

// ---------------------------------------------------------------------------
// Sync getter for proxy hot path
// ---------------------------------------------------------------------------

/**
 * Resolve routing strategy with priority:
 * 1. Header (user explicitly set, unless it's the default smart_auto)
 * 2. Per-user admin override
 * 3. Global default
 */
export function resolveStrategy(
  userId: string,
  headerStrategy: string | undefined,
): string {
  // 1. Header wins if user explicitly set something other than default
  if (headerStrategy && headerStrategy !== "smart_auto") return headerStrategy;
  // 2. Per-user admin override
  const override = userOverrides.get(userId);
  if (override) return override;
  // 3. Global default
  return globalStrategy;
}
