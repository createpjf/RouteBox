// ---------------------------------------------------------------------------
// Marketplace settlement — usage recording and earnings distribution
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";
import { addCredits } from "./credits";
import { log } from "./logger";

const PLATFORM_FEE_RATE = 0.15; // 15% platform fee

/** Record a marketplace usage event and deduct consumer credits */
export async function recordMarketplaceUsage(
  listingId: string,
  consumerId: string,
  ownerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  consumerCostCents: number,
  latencyMs: number,
  status: "success" | "error" = "success",
): Promise<void> {
  const platformFeeCents = Math.round(consumerCostCents * PLATFORM_FEE_RATE);
  const ownerEarningCents = consumerCostCents - platformFeeCents;

  await sql`
    INSERT INTO marketplace_usage
      (listing_id, consumer_id, owner_id, model, input_tokens, output_tokens, consumer_cost_cents, owner_earning_cents, platform_fee_cents, latency_ms, status)
    VALUES
      (${listingId}, ${consumerId}, ${ownerId}, ${model}, ${inputTokens}, ${outputTokens}, ${consumerCostCents}, ${ownerEarningCents}, ${platformFeeCents}, ${latencyMs}, ${status})
  `;

  // Update shared_keys total_earned_cents
  await sql`
    UPDATE shared_keys
    SET total_earned_cents = total_earned_cents + ${ownerEarningCents}
    WHERE id = (SELECT shared_key_id FROM marketplace_listings WHERE id = ${listingId})
  `;

  log.info("marketplace_usage_recorded", {
    listingId, consumerId, ownerId, model,
    consumerCostCents, ownerEarningCents, platformFeeCents,
  });
}

/** Settle unsettled earnings — transfer to owner credits balance */
export async function settleOwnerEarnings(): Promise<number> {
  // Find owners with unsettled earnings
  const ownerTotals = await sql`
    SELECT
      owner_id,
      COUNT(*)::int as total_requests,
      SUM(owner_earning_cents)::int as total_earning_cents,
      MIN(created_at) as period_start,
      MAX(created_at) as period_end
    FROM marketplace_usage
    WHERE created_at > (
      SELECT COALESCE(MAX(period_end), '2000-01-01'::timestamptz)
      FROM marketplace_settlements
      WHERE settled = true
    )
    GROUP BY owner_id
    HAVING SUM(owner_earning_cents) > 0
  `;

  let settledCount = 0;

  for (const row of ownerTotals) {
    const ownerId = row.owner_id as string;
    const totalEarningCents = row.total_earning_cents as number;
    const totalRequests = row.total_requests as number;
    const periodStart = row.period_start as string;
    const periodEnd = row.period_end as string;

    try {
      // Add earnings to owner's credits
      await addCredits(
        ownerId,
        totalEarningCents,
        `marketplace_settlement_${Date.now()}`,
      );

      // Record settlement
      await sql`
        INSERT INTO marketplace_settlements (owner_id, period_start, period_end, total_requests, total_earning_cents, settled, settled_at)
        VALUES (${ownerId}, ${periodStart}, ${periodEnd}, ${totalRequests}, ${totalEarningCents}, true, now())
      `;

      settledCount++;
      log.info("marketplace_settlement_completed", {
        ownerId, totalEarningCents, totalRequests,
      });
    } catch (err) {
      log.error("marketplace_settlement_failed", {
        ownerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return settledCount;
}

/** Get earnings summary for a key owner */
export async function getOwnerEarnings(ownerId: string): Promise<{
  totalEarnedCents: number;
  totalRequests: number;
  pendingSettlementCents: number;
}> {
  const [totals] = await sql`
    SELECT
      COALESCE(SUM(owner_earning_cents), 0)::int as total_earned,
      COALESCE(COUNT(*), 0)::int as total_requests
    FROM marketplace_usage
    WHERE owner_id = ${ownerId}
  `;

  const [settled] = await sql`
    SELECT COALESCE(SUM(total_earning_cents), 0)::int as settled_total
    FROM marketplace_settlements
    WHERE owner_id = ${ownerId} AND settled = true
  `;

  const totalEarned = (totals?.total_earned as number) || 0;
  const settledTotal = (settled?.settled_total as number) || 0;

  return {
    totalEarnedCents: totalEarned,
    totalRequests: (totals?.total_requests as number) || 0,
    pendingSettlementCents: Math.max(0, totalEarned - settledTotal),
  };
}

/** Get earnings history for a key owner */
export async function getEarningsHistory(
  ownerId: string,
  page = 1,
  limit = 20,
): Promise<{ records: Record<string, unknown>[]; total: number }> {
  const offset = (page - 1) * limit;

  const records = await sql`
    SELECT id, model, consumer_cost_cents, owner_earning_cents, platform_fee_cents, created_at
    FROM marketplace_usage
    WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRow] = await sql`
    SELECT COUNT(*)::int as total FROM marketplace_usage WHERE owner_id = ${ownerId}
  `;

  return {
    records,
    total: (countRow?.total as number) || 0,
  };
}
