-- Migration 009: User short UID (rb + 8 uppercase hex)
-- Format: rbA1B2C3D4 (10 chars)

ALTER TABLE users ADD COLUMN IF NOT EXISTS uid VARCHAR(12) UNIQUE;

-- Populate existing users
UPDATE users
SET uid = 'rb' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8))
WHERE uid IS NULL;

-- Default for new users
ALTER TABLE users
  ALTER COLUMN uid SET DEFAULT 'rb' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users(uid);
