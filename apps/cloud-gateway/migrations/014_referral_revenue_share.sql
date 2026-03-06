-- ---------------------------------------------------------------------------
-- Migration 014: Referral revenue-share model
-- Adds monthly earnings tracking and welcome bonus to referral system
-- ---------------------------------------------------------------------------

-- 1. Extend referrals table with revenue-share config
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS revenue_share_pct   INTEGER NOT NULL DEFAULT 10,    -- 10%
  ADD COLUMN IF NOT EXISTS revenue_share_months INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS total_earned_cents   INTEGER NOT NULL DEFAULT 0;

-- 2. Monthly referral earnings ledger
CREATE TABLE IF NOT EXISTS referral_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month    DATE NOT NULL,               -- YYYY-MM-01
  api_spend_cents INTEGER NOT NULL DEFAULT 0,  -- referred user's API spend that month
  earning_cents   INTEGER NOT NULL DEFAULT 0,  -- referrer's earning (spend × share_pct/100)
  is_paid         BOOLEAN NOT NULL DEFAULT false,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referred_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer
  ON referral_earnings (referrer_id, is_paid);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_period
  ON referral_earnings (period_month);

-- 3. Add welcome_bonus_cents to referral_claims
ALTER TABLE referral_claims
  ADD COLUMN IF NOT EXISTS welcome_bonus_cents INTEGER NOT NULL DEFAULT 300; -- $3 welcome bonus
