-- H1: Track failed credit deductions for retry
CREATE TABLE IF NOT EXISTS pending_deductions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_cents    INTEGER NOT NULL,
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  request_id    TEXT,
  retries       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | resolved | failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_deductions_status
  ON pending_deductions (status) WHERE status = 'pending';
