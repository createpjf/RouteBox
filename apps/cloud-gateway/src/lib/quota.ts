// ---------------------------------------------------------------------------
// Daily quota — Starter plan per-model daily usage limits
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";

/** Daily request limits per model for Starter users.
 *  Models not listed here have no quota restriction for Starter. */
const STARTER_DAILY_QUOTA: Record<string, number> = {
  // Expensive models — tight limits for free tier
  "gpt-4o":          20,
  "gpt-4":           10,
  "claude-3-5":      20,
  "claude-3-opus":   5,
  "claude-opus":     5,
  "gemini-1.5-pro":  20,
  "gemini-2":        20,
  // Mid-tier models
  "deepseek":        50,
  "kimi-k2.5":       50,
  "kimi-k2":         30,
  // Cheap models — generous limits
  "gpt-3.5":         100,
  "minimax":         100,
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

  // M1: Unknown models get a conservative default limit (prevents quota bypass via new model versions)
  if (limit === undefined) {
    limit = 5;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Atomic check-and-increment: INSERT or UPDATE and RETURN the new count
  // This prevents concurrent requests from all passing the check
  const [row] = await sql`
    INSERT INTO daily_quota_usage (user_id, quota_date, model_id, used_count)
    VALUES (${userId}, ${today}, ${model}, 1)
    ON CONFLICT (user_id, quota_date, model_id)
    DO UPDATE SET used_count = daily_quota_usage.used_count + 1
    RETURNING used_count
  `;
  const newCount = (row?.used_count as number) ?? 1;

  const resetAt = new Date();
  resetAt.setUTCDate(resetAt.getUTCDate() + 1);
  resetAt.setUTCHours(0, 0, 0, 0); // next midnight UTC

  if (newCount > limit) {
    // Over limit — roll back the increment
    await sql`
      UPDATE daily_quota_usage
      SET used_count = used_count - 1
      WHERE user_id = ${userId} AND quota_date = ${today} AND model_id = ${model}
    `;
    return { allowed: false, remaining: 0, resetAt };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - newCount),
    resetAt,
  };
}

/** Decrement daily quota counter (call if request fails after check). */
export async function decrementDailyQuota(userId: string, model: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await sql`
    UPDATE daily_quota_usage
    SET used_count = GREATEST(used_count - 1, 0)
    WHERE user_id = ${userId} AND quota_date = ${today} AND model_id = ${model}
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
