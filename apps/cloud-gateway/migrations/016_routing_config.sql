-- Global routing config (singleton row)
CREATE TABLE IF NOT EXISTS routing_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_strategy VARCHAR(20) NOT NULL DEFAULT 'smart_auto',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO routing_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Per-user routing overrides (admin-set)
CREATE TABLE IF NOT EXISTS user_routing_override (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  strategy VARCHAR(20) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
