-- ---------------------------------------------------------------------------
-- Migration 011: Three-tier plans (starter / pro / max) + subscription promotions
-- Renames free → starter, adds max
-- ---------------------------------------------------------------------------

-- 1. Drop existing check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;

-- 2. Migrate existing free users to starter
UPDATE users SET plan = 'starter' WHERE plan = 'free';

-- 3. Update default + add new constraint
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'starter';
ALTER TABLE users ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('starter', 'pro', 'max'));

-- 4. First-month promotions table
CREATE TABLE IF NOT EXISTS subscription_promotions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan                  TEXT NOT NULL,
  polar_product_id_promo TEXT NOT NULL,  -- Polar discounted product ID
  discount_pct          INTEGER NOT NULL,  -- e.g. 50 = 50% off
  valid_until           TIMESTAMPTZ NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
