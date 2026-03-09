-- 022: Webhook event persistence (C3) + composite indexes (M6)

-- Webhook events table for idempotent processing and replay
CREATE TABLE IF NOT EXISTS webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  webhook_id    TEXT NOT NULL UNIQUE,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'received',  -- received | processing | processed | failed
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events (event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events (status) WHERE status != 'processed';

-- M6: Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions (user_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON requests (user_id, created_at DESC);
