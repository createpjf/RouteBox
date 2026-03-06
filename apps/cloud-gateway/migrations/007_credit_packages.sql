-- ---------------------------------------------------------------------------
-- Migration 007: DB-backed credit packages
-- Moves CREDIT_PACKAGES from hardcoded code to database
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_packages (
  id               text PRIMARY KEY,
  polar_product_id text NOT NULL DEFAULT '',
  amount_cents     int  NOT NULL,
  credits_cents    int  NOT NULL,
  label            text NOT NULL,
  bonus            text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int  NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- Seed initial data (update polar_product_id via admin after migration)
INSERT INTO credit_packages (id, polar_product_id, amount_cents, credits_cents, label, bonus, is_active, sort_order) VALUES
  ('credits_5',  '', 500,  500,  '$5',  NULL,   true, 0),
  ('credits_20', '', 2000, 2200, '$20', '+10%', true, 1)
ON CONFLICT DO NOTHING;
