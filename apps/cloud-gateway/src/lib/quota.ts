// ---------------------------------------------------------------------------
// Daily quota — Starter plan per-model daily usage limits
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";

/** Daily request limits per model for Starter users */
const STARTER_DAILY_QUOTA: Record<string, number> = {
  "kimi-k2.5": 50,
  "kimi-k2":   30,
};

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/** Check if a user is within their daily quota for a given model.
 *  Pro/Max users are always allowed (unlimited).
 *  Returns { allowed, remaining, resetAt }. */
export async function checkDailyQuota(
  userId: string,
  model: string,
  userPlan: string,
): Promise<QuotaResult> {
  // Non-starter plans: no quota restrictions
  if (userPlan !== "starter") {
    const resetAt = new Date();
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);
    resetAt.setUTCHours(0, 0, 0, 0);
    return { allowed: true, remaining: Infinity, resetAt };
  }

  // Find the applicable quota limit (exact match, then prefix)
  let limit: number | undefined = STARTER_DAILY_QUOTA[model];
  if (limit === undefined) {
    for (const [key, val] of Object.entries(STARTER_DAILY_QUOTA)) {
      if (model.startsWith(key)) { limit = val; break; }
    }
  }

  // Model has no quota restriction for Starter
  if (limit === undefined) {
    const resetAt = new Date();
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);
    resetAt.setUTCHours(0, 0, 0, 0);
    return { allowed: true, remaining: Infinity, resetAt };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const [row] = await sql`
    SELECT used_count FROM daily_quota_usage
    WHERE user_id = ${userId} AND quota_date = ${today} AND model_id = ${model}
  `;
  const used = (row?.used_count as number) ?? 0;

  const resetAt = new Date();
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0); // next midnight UTC

  return {
    allowed: used < limit,
    remaining: Math.max(0, limit - used),
    resetAt,
  };
}

/** Increment daily quota counter after a successful request. */
export async function incrementDailyQuota(userId: string, model: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    INSERT INTO daily_quota_usage (user_id, quota_date, model_id, used_count)
    VALUES (${userId}, ${today}, ${model}, 1)
    ON CONFLICT (user_id, quota_date, model_id)
    DO UPDATE SET used_count = daily_quota_usage.used_count + 1
  `;
}

/** Get quota usage summary for a user (for account display). */
export async function getUserQuotaUsage(
  userId: string,
): Promise<{ model: string; used: number; limit: number; date: string }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await sql`
    SELECT model_id, used_count
    FROM daily_quota_usage
    WHERE user_id = ${userId} AND quota_date = ${today}
  `;

  return rows.map((r) => ({
    model: r.model_id as string,
    used: r.used_count as number,
    limit: STARTER_DAILY_QUOTA[r.model_id as string] ?? 0,
    date: today,
  }));
}
