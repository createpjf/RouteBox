-- Migration 018: Admin audit log, cascade deletes, missing indexes
-- Created: 2026-03-08

-- ── Admin audit log table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email   TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_user_id UUID,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin
  ON admin_audit_log (admin_email);

-- ── CASCADE on password_reset_tokens → users ────────────────────────────────

ALTER TABLE password_reset_tokens
  DROP CONSTRAINT IF EXISTS password_reset_tokens_user_id_fkey;

ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── CASCADE on api_keys → users ─────────────────────────────────────────────

ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_user_id_fkey;

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── Missing index on referral_claims(referral_id) ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_referral_claims_referral
  ON referral_claims (referral_id);
