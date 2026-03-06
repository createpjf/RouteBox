-- Phase 2: Subscriptions + Referrals
-- Run after 001_init.sql

-- Subscription plans
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  stripe_subscription_id VARCHAR(255) UNIQUE,
  plan VARCHAR(20) NOT NULL,           -- 'pro' | 'business'
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'canceled' | 'past_due'
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- Referral codes
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  code VARCHAR(20) UNIQUE NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER DEFAULT NULL,       -- NULL = unlimited
  reward_cents INTEGER NOT NULL DEFAULT 200,  -- $2.00 per referral
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);

-- Referral claim tracking
CREATE TABLE IF NOT EXISTS referral_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id),
  referred_user_id UUID NOT NULL REFERENCES users(id),
  referrer_rewarded BOOLEAN NOT NULL DEFAULT false,
  referred_rewarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_claims_user ON referral_claims(referred_user_id);

-- Add referred_by column to users (tracks which referral code was used)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES referrals(id);
