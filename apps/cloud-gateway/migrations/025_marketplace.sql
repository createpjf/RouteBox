-- Marketplace: Shared API Keys
CREATE TABLE IF NOT EXISTS shared_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  models TEXT[] NOT NULL DEFAULT '{}',
  rate_limit_rpm INT DEFAULT 60,
  daily_limit INT DEFAULT 1000,
  status TEXT DEFAULT 'pending',
  error_count INT DEFAULT 0,
  last_error TEXT,
  last_used_at TIMESTAMPTZ,
  total_requests INT DEFAULT 0,
  total_earned_cents INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace: Listings
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_key_id UUID NOT NULL REFERENCES shared_keys(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  models TEXT[] NOT NULL,
  price_input_per_m DECIMAL(10,4) NOT NULL,
  price_output_per_m DECIMAL(10,4) NOT NULL,
  description TEXT DEFAULT '',
  available BOOLEAN DEFAULT TRUE,
  avg_latency_ms INT,
  success_rate DECIMAL(5,2) DEFAULT 100.00,
  total_served INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace: Usage records
CREATE TABLE IF NOT EXISTS marketplace_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id),
  consumer_id UUID NOT NULL REFERENCES users(id),
  owner_id UUID NOT NULL REFERENCES users(id),
  model TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  consumer_cost_cents INT NOT NULL,
  owner_earning_cents INT NOT NULL,
  platform_fee_cents INT NOT NULL,
  latency_ms INT,
  status TEXT DEFAULT 'success',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketplace: Settlement records
CREATE TABLE IF NOT EXISTS marketplace_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_requests INT NOT NULL,
  total_earning_cents INT NOT NULL,
  settled BOOLEAN DEFAULT FALSE,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shared_keys_owner ON shared_keys(owner_id);
CREATE INDEX IF NOT EXISTS idx_shared_keys_status ON shared_keys(status);
CREATE INDEX IF NOT EXISTS idx_listings_available ON marketplace_listings(provider_name, available);
CREATE INDEX IF NOT EXISTS idx_listings_owner ON marketplace_listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_mp_usage_consumer ON marketplace_usage(consumer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mp_usage_owner ON marketplace_usage(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mp_usage_listing ON marketplace_usage(listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_settlements_owner ON marketplace_settlements(owner_id, settled);
