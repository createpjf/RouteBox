-- ---------------------------------------------------------------------------
-- Migration 013: Credits bonus_cents + daily quota tracking + updated credit packages
-- ---------------------------------------------------------------------------

-- 1. Add bonus_cents to credits table
ALTER TABLE credits ADD COLUMN IF NOT EXISTS bonus_cents INTEGER NOT NULL DEFAULT 0;

-- 2. Daily quota usage tracking (Starter plan per-model daily limits)
CREATE TABLE IF NOT EXISTS daily_quota_usage (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
  model_id   TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, quota_date, model_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_quota_usage_user_date
  ON daily_quota_usage (user_id, quota_date);

-- 3. Refresh credit packages to 5-tier structure
--    Keep existing rows quiet on conflict; a separate admin action can update polar_product_id
DELETE FROM credit_packages WHERE id IN ('credits_5','credits_10','credits_20','credits_25','credits_50','credits_100');

INSERT INTO credit_packages (id, polar_product_id, amount_cents, credits_cents, label, bonus, is_active, sort_order) VALUES
  ('credits_5',   '', 500,   500,   '$5 Credits',   NULL,   true, 0),
  ('credits_10',  '', 1000,  1050,  '$10 Credits',  '+5%',  true, 1),
  ('credits_25',  '', 2500,  2750,  '$25 Credits',  '+10%', true, 2),
  ('credits_50',  '', 5000,  5750,  '$50 Credits',  '+15%', true, 3),
  ('credits_100', '', 10000, 12000, '$100 Credits', '+20%', true, 4);
