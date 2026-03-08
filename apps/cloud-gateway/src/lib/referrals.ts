// ---------------------------------------------------------------------------
// Referral system — code generation, claim tracking, revenue-share rewards
// ---------------------------------------------------------------------------

import { sql, withTx } from "./db-cloud";
import { addBonusCredits } from "./credits";
import { log } from "./logger";

const WELCOME_BONUS_CENTS = 300;      // $3 welcome bonus for new referred user
const MIN_DEPOSIT_FOR_WELCOME = 500;  // $5 minimum deposit to trigger welcome bonus
const REVENUE_SHARE_PCT = 10;         // 10% of referred user's API spend
const REVENUE_SHARE_MONTHS = 3;       // 3 months duration
const MAX_REFERRER_REWARDS = 50;      // Max 50 active referrals earning

/** Generate a random 6-character referral code using crypto RNG */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// ---------------------------------------------------------------------------
// Get or create referral code for a user
// ---------------------------------------------------------------------------

export async function getOrCreateReferralCode(
  userId: string,
): Promise<{ code: string; uses: number; totalRewardCents: number }> {
  const [existing] = await sql`
    SELECT code, uses FROM referrals WHERE referrer_id = ${userId}
  `;

  if (existing) {
    const [earned] = await sql`
      SELECT COALESCE(SUM(earning_cents), 0)::int AS total
      FROM referral_earnings
      WHERE referrer_id = ${userId}
    `;
    return {
      code: existing.code as string,
      uses: existing.uses as number,
      totalRewardCents: (earned?.total as number) ?? 0,
    };
  }

  // Generate unique code
  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    const [dup] = await sql`SELECT id FROM referrals WHERE code = ${code}`;
    if (!dup) break;
    attempts++;
    if (attempts >= 10) {
      throw new Error("Failed to generate unique referral code after 10 attempts");
    }
  } while (true);

  await sql`
    INSERT INTO referrals (referrer_id, code, reward_cents, revenue_share_pct, revenue_share_months)
    VALUES (${userId}, ${code}, ${WELCOME_BONUS_CENTS}, ${REVENUE_SHARE_PCT}, ${REVENUE_SHARE_MONTHS})
  `;

  return { code, uses: 0, totalRewardCents: 0 };
}

// ---------------------------------------------------------------------------
// Claim a referral code during registration
// ---------------------------------------------------------------------------

export async function claimReferral(
  referralCode: string,
  newUserId: string,
): Promise<boolean> {
  const [ref] = await sql`
    SELECT id, referrer_id, uses, max_uses
    FROM referrals WHERE code = ${referralCode.toUpperCase()}
  `;

  if (!ref) return false;

  if (ref.max_uses !== null && (ref.uses as number) >= (ref.max_uses as number)) {
    return false;
  }

  if (ref.referrer_id === newUserId) return false;

  const [existingClaim] = await sql`
    SELECT id FROM referral_claims WHERE referred_user_id = ${newUserId}
  `;
  if (existingClaim) return false;

  await sql`
    INSERT INTO referral_claims (referral_id, referred_user_id, welcome_bonus_cents)
    VALUES (${ref.id as string}, ${newUserId}, ${WELCOME_BONUS_CENTS})
  `;
  await sql`
    UPDATE referrals SET uses = uses + 1 WHERE id = ${ref.id as string}
  `;
  await sql`
    UPDATE users SET referred_by = ${ref.id as string} WHERE id = ${newUserId}
  `;

  return true;
}

// ---------------------------------------------------------------------------
// Claim welcome bonus for referred user after first qualifying deposit
// ---------------------------------------------------------------------------

export async function claimReferralWelcome(referredUserId: string): Promise<void> {
  // Find unpaid referral claim for this user
  const [claim] = await sql`
    SELECT rc.id, rc.referral_id, rc.referred_rewarded, rc.welcome_bonus_cents,
           r.referrer_id
    FROM referral_claims rc
    JOIN referrals r ON r.id = rc.referral_id
    WHERE rc.referred_user_id = ${referredUserId}
      AND rc.referred_rewarded = false
  `;

  if (!claim) return;

  // Check qualifying deposit
  const [deposits] = await sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM transactions
    WHERE user_id = ${referredUserId} AND type = 'deposit'
  `;
  if ((deposits?.total as number ?? 0) < MIN_DEPOSIT_FOR_WELCOME) return;

  const bonusCents = (claim.welcome_bonus_cents as number) ?? WELCOME_BONUS_CENTS;

  await withTx(async (tx) => {
    // Atomically mark as rewarded — only proceeds if not yet rewarded.
    // The AND guard prevents double-issuance from concurrent calls.
    const [updated] = await tx`
      UPDATE referral_claims
      SET referred_rewarded = true
      WHERE id = ${claim.id as string}
        AND referred_rewarded = false
      RETURNING id
    `;
    if (!updated) return; // Concurrent call already processed this claim

    // Add bonus credits within the SAME transaction for atomicity
    const [row] = await tx`
      UPDATE credits
      SET bonus_cents = bonus_cents + ${bonusCents}, updated_at = now()
      WHERE user_id = ${referredUserId}
      RETURNING balance_cents, bonus_cents
    `;
    const newBalance = (row?.balance_cents as number) ?? 0;
    const newBonus = (row?.bonus_cents as number) ?? 0;
    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (${referredUserId}, 'bonus', ${bonusCents}, ${newBalance + newBonus}, 'Referral welcome bonus')
    `;
  });

  log.info("referral_welcome_claimed", { referredUserId, bonusCents });
}

// ---------------------------------------------------------------------------
// Monthly revenue-share: batch process referral earnings for a period
// ---------------------------------------------------------------------------

/** Calculate and issue referral earnings for a given month.
 *  Format: "2026-03" (YYYY-MM) */
export async function processMonthlyReferralEarnings(periodMonth: string): Promise<{
  processed: number;
  totalEarningCents: number;
}> {
  // Normalize to YYYY-MM-01 date
  const periodDate = `${periodMonth}-01`;

  // Find all active referrals (claim within the revenue_share_months window)
  const cutoffDate = new Date(periodDate);
  cutoffDate.setMonth(cutoffDate.getMonth() - REVENUE_SHARE_MONTHS);

  const claims = await sql`
    SELECT rc.id AS claim_id, rc.referred_user_id, r.referrer_id,
           r.revenue_share_pct, r.revenue_share_months, rc.created_at
    FROM referral_claims rc
    JOIN referrals r ON r.id = rc.referral_id
    WHERE rc.referred_rewarded = true
      AND rc.created_at > ${cutoffDate}
  `;

  let processed = 0;
  let totalEarningCents = 0;

  for (const claim of claims) {
    const referrerId = claim.referrer_id as string;
    const referredId = claim.referred_user_id as string;
    const sharePct = (claim.revenue_share_pct as number) ?? REVENUE_SHARE_PCT;

    // Check if already processed for this period
    const [existing] = await sql`
      SELECT id FROM referral_earnings
      WHERE referrer_id = ${referrerId}
        AND referred_id = ${referredId}
        AND period_month = ${periodDate}
    `;
    if (existing) continue;

    // Sum API spend for the referred user in that month
    const monthStart = new Date(periodDate);
    const monthEnd = new Date(periodDate);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const [spend] = await sql`
      SELECT COALESCE(SUM(ABS(amount_cents)), 0)::int AS total
      FROM transactions
      WHERE user_id = ${referredId}
        AND type = 'usage'
        AND created_at >= ${monthStart}
        AND created_at < ${monthEnd}
    `;

    const apiSpendCents = (spend?.total as number) ?? 0;
    if (apiSpendCents === 0) continue;

    const earningCents = Math.floor(apiSpendCents * sharePct / 100);
    if (earningCents === 0) continue;

    // Insert earning record — use RETURNING to detect if insert was skipped by conflict
    const [inserted] = await sql`
      INSERT INTO referral_earnings (referrer_id, referred_id, period_month, api_spend_cents, earning_cents)
      VALUES (${referrerId}, ${referredId}, ${periodDate}, ${apiSpendCents}, ${earningCents})
      ON CONFLICT (referrer_id, referred_id, period_month) DO NOTHING
      RETURNING id
    `;

    // Only proceed if we actually inserted (not skipped by concurrent call or re-run)
    if (!inserted) continue;

    // Issue bonus credits to referrer
    await addBonusCredits(referrerId, earningCents, "referral_earning");

    // Update referral total_earned_cents
    await sql`
      UPDATE referrals
      SET total_earned_cents = total_earned_cents + ${earningCents}
      WHERE referrer_id = ${referrerId}
    `;

    // Mark earning as paid
    await sql`
      UPDATE referral_earnings
      SET is_paid = true, paid_at = now()
      WHERE referrer_id = ${referrerId}
        AND referred_id = ${referredId}
        AND period_month = ${periodDate}
    `;

    processed++;
    totalEarningCents += earningCents;

    log.info("referral_earning_issued", {
      referrerId,
      referredId,
      periodMonth,
      apiSpendCents,
      earningCents,
    });
  }

  return { processed, totalEarningCents };
}

// ---------------------------------------------------------------------------
// Legacy: kept for backward compat (now delegates to claimReferralWelcome)
// ---------------------------------------------------------------------------

export async function processReferralReward(userId: string): Promise<void> {
  await claimReferralWelcome(userId);
}
