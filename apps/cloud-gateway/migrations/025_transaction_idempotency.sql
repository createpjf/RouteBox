-- ---------------------------------------------------------------------------
-- Migration 025: Transaction idempotency hardening
-- ---------------------------------------------------------------------------

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Preserve historical payment references as idempotency keys where possible.
UPDATE transactions
SET idempotency_key = payment_ref
WHERE idempotency_key IS NULL
  AND payment_ref IS NOT NULL;

-- Prevent concurrent duplicate deposits for the same provider payment/session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_ref_unique
  ON transactions (payment_ref)
  WHERE payment_ref IS NOT NULL;

-- Prevent duplicate bonus application for the same user/reason key while still
-- allowing shared promo names across different users when callers choose that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bonus_idempotency_unique
  ON transactions (user_id, type, idempotency_key)
  WHERE type = 'bonus' AND idempotency_key IS NOT NULL;
