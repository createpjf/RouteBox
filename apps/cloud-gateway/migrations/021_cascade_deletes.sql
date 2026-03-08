-- Migration 021: Add ON DELETE CASCADE to FK constraints referencing users(id)
-- Ensures user deletion properly cascades and satisfies GDPR requirements.

-- ── credits → users ────────────────────────────────────────────────────────
ALTER TABLE credits
  DROP CONSTRAINT IF EXISTS credits_user_id_fkey;
ALTER TABLE credits
  ADD CONSTRAINT credits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── transactions → users ───────────────────────────────────────────────────
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── requests → users ───────────────────────────────────────────────────────
ALTER TABLE requests
  DROP CONSTRAINT IF EXISTS requests_user_id_fkey;
ALTER TABLE requests
  ADD CONSTRAINT requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── subscriptions → users ──────────────────────────────────────────────────
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ── admin_audit_log.target_user_id → users (SET NULL on delete) ────────────
ALTER TABLE admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_target_user_id_fkey;
ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_log_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- ── daily_quota → users ────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_quota') THEN
    EXECUTE 'ALTER TABLE daily_quota DROP CONSTRAINT IF EXISTS daily_quota_user_id_fkey';
    EXECUTE 'ALTER TABLE daily_quota ADD CONSTRAINT daily_quota_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE';
  END IF;
END $$;
