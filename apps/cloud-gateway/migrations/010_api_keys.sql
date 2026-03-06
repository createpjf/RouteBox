-- Migration 010: Gateway API keys (rb_ prefix)
-- Key format: rb_ + 32 random hex = 35 chars total
-- Stored: SHA-256 hash; only key_prefix ("rb_XXXXXXXX" first 12 chars) is returned after creation

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256(full_key) stored
  key_prefix   VARCHAR(16) NOT NULL,   -- "rb_XXXXXXXX" first 12 chars for display
  name         VARCHAR(100) DEFAULT 'Default',
  last_used_at TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(user_id, is_active);
