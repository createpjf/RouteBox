CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  plan VARCHAR(20) NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credits balance
CREATE TABLE IF NOT EXISTS credits (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  total_deposited_cents INTEGER NOT NULL DEFAULT 0,
  total_used_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transaction ledger
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(20) NOT NULL,  -- 'deposit' | 'usage' | 'refund' | 'bonus'
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  description TEXT,
  stripe_session_id VARCHAR(255),
  model VARCHAR(100),
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);

-- Request log (for analytics)
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  model VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id, created_at DESC);
