-- Add status column to users table for ban/suspend functionality
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Enforce valid status values at DB level
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT chk_users_status
    CHECK (status IN ('active', 'suspended', 'banned'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
