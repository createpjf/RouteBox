-- ---------------------------------------------------------------------------
-- Migration 025: Transaction idempotency hardening
-- ---------------------------------------------------------------------------

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Clear legacy duplicate payment refs before enforcing uniqueness. Keep the
-- earliest ledger row for each ref and preserve later rows for audit history.
WITH duplicate_payment_refs AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY payment_ref ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE payment_ref IS NOT NULL
  ) ranked
  WHERE rn > 1
)
UPDATE transactions
SET payment_ref = NULL,
    description = concat_ws(
      ' ',
      NULLIF(transactions.description, ''),
      '[duplicate payment_ref cleared before idempotency index]'
    )
FROM duplicate_payment_refs
WHERE transactions.id = duplicate_payment_refs.id;

-- Preserve historical payment references as idempotency keys where possible.
UPDATE transactions
SET idempotency_key = payment_ref
WHERE idempotency_key IS NULL
  AND payment_ref IS NOT NULL;

-- Clear legacy duplicate bonus idempotency keys before enforcing uniqueness.
-- Keep the earliest bonus row per user/key and preserve later rows for audit.
WITH duplicate_bonus_idempotency AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY user_id, type, idempotency_key ORDER BY created_at, id) AS rn
    FROM transactions
    WHERE type = 'bonus'
      AND idempotency_key IS NOT NULL
  ) ranked
  WHERE rn > 1
)
UPDATE transactions
SET idempotency_key = NULL,
    description = concat_ws(
      ' ',
      NULLIF(transactions.description, ''),
      '[duplicate bonus idempotency_key cleared before idempotency index]'
    )
FROM duplicate_bonus_idempotency
WHERE transactions.id = duplicate_bonus_idempotency.id;

-- Prevent concurrent duplicate deposits for the same provider payment/session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_payment_ref_unique
  ON transactions (payment_ref)
  WHERE payment_ref IS NOT NULL;

-- Prevent duplicate bonus application for the same user/reason key while still
-- allowing shared promo names across different users when callers choose that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bonus_idempotency_unique
  ON transactions (user_id, type, idempotency_key)
  WHERE type = 'bonus' AND idempotency_key IS NOT NULL;
