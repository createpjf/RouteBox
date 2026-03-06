// ---------------------------------------------------------------------------
// Referral system — code generation, claim tracking, reward distribution
// ---------------------------------------------------------------------------

import { sql, withTx } from "./db-cloud";
import { log } from "./logger";

const REFERRAL_REWARD_CENTS = 200;    // $2.00 per referral
const MIN_DEPOSIT_FOR_REWARD = 500;   // $5.00 minimum deposit to trigger reward
const MAX_REFERRER_REWARDS = 50;      // Max 50 referrals = $100

/** Generate a random 6-character referral code */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Get or create referral code for a user
// ---------------------------------------------------------------------------

export async function getOrCreateReferralCode(
  userId: string,
): Promise<{ code: string; uses: number; totalRewardCents: number }> {
  // Check existing
  const [existing] = await sql`
    SELECT code, uses FROM referrals WHERE referrer_id = ${userId}
  `;

  if (existing) {
    // Calculate total rewards earned
    const [reward] = await sql`
      SELECT COUNT(*)::int AS count
      FROM referral_claims
      WHERE referral_id = (SELECT id FROM referrals WHERE referrer_id = ${userId})
        AND referrer_rewarded = true
    `;
    return {
      code: existing.code as string,
      uses: existing.uses as number,
      totalRewardCents: (reward?.count as number ?? 0) * REFERRAL_REWARD_CENTS,
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
  } while (attempts < 10);

  await sql`
    INSERT INTO referrals (referrer_id, code, reward_cents)
    VALUES (${userId}, ${code}, ${REFERRAL_REWARD_CENTS})
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

  // Check max uses
  if (ref.max_uses !== null && (ref.uses as number) >= (ref.max_uses as number)) {
    return false;
  }

  // Don't allow self-referral
  if (ref.referrer_id === newUserId) return false;

  // Check if user already claimed any referral
  const [existingClaim] = await sql`
    SELECT id FROM referral_claims WHERE referred_user_id = ${newUserId}
  `;
  if (existingClaim) return false;

  // Create claim + update referral uses + link user
  await sql`
    INSERT INTO referral_claims (referral_id, referred_user_id)
    VALUES (${ref.id as string}, ${newUserId})
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
// Process referral reward after first qualifying deposit
// ---------------------------------------------------------------------------

export async function processReferralReward(userId: string): Promise<void> {
  // Find unclaimed referral for this user
  const [claim] = await sql`
    SELECT rc.id, rc.referral_id, rc.referred_rewarded, rc.referrer_rewarded,
           r.referrer_id, r.reward_cents
    FROM referral_claims rc
    JOIN referrals r ON r.id = rc.referral_id
    WHERE rc.referred_user_id = ${userId}
      AND (rc.referred_rewarded = false OR rc.referrer_rewarded = false)
  `;

  if (!claim) return;

  // Check if user has deposited enough
  const [deposits] = await sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM transactions
    WHERE user_id = ${userId} AND type = 'deposit'
  `;
  if ((deposits?.total as number ?? 0) < MIN_DEPOSIT_FOR_REWARD) return;

  const rewardCents = claim.reward_cents as number;
  const referrerId = claim.referrer_id as string;

  // Check if referrer hasn't exceeded max rewards
  const [referrerRewards] = await sql`
    SELECT COUNT(*)::int AS count
    FROM referral_claims
    WHERE referral_id IN (SELECT id FROM referrals WHERE referrer_id = ${referrerId})
      AND referrer_rewarded = true
  `;
  const referrerRewardCount = referrerRewards?.count as number ?? 0;

  await withTx(async (tx) => {
    // Reward referred user (if not already)
    if (!(claim.referred_rewarded as boolean)) {
      await tx`
        UPDATE credits
        SET balance_cents = balance_cents + ${rewardCents},
            total_deposited_cents = total_deposited_cents + ${rewardCents},
            updated_at = now()
        WHERE user_id = ${userId}
      `;
      const [bal] = await tx`SELECT balance_cents FROM credits WHERE user_id = ${userId}`;
      await tx`
        INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
        VALUES (${userId}, 'bonus', ${rewardCents}, ${(bal?.balance_cents as number) ?? 0},
                'Referral welcome bonus')
      `;
    }

    // Reward referrer (if not already and under cap)
    if (!(claim.referrer_rewarded as boolean) && referrerRewardCount < MAX_REFERRER_REWARDS) {
      await tx`
        UPDATE credits
        SET balance_cents = balance_cents + ${rewardCents},
            total_deposited_cents = total_deposited_cents + ${rewardCents},
            updated_at = now()
        WHERE user_id = ${referrerId}
      `;
      const [rBal] = await tx`SELECT balance_cents FROM credits WHERE user_id = ${referrerId}`;
      await tx`
        INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
        VALUES (${referrerId}, 'bonus', ${rewardCents}, ${(rBal?.balance_cents as number) ?? 0},
                'Referral reward')
      `;
    }

    // Mark claim as rewarded
    await tx`
      UPDATE referral_claims
      SET referred_rewarded = true,
          referrer_rewarded = ${referrerRewardCount < MAX_REFERRER_REWARDS}
      WHERE id = ${claim.id as string}
    `;
  });

  log.info("referral_reward_processed", { referredUserId: userId, referrerId, rewardCents });
}
