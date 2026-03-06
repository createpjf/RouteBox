-- Phase 4: Admin-configurable provider keys + provider access control

-- Provider API keys (DB-managed, supplements env vars)
CREATE TABLE IF NOT EXISTS provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name VARCHAR(50) NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  label VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider_name, is_active);

-- Provider access control (which plans can use which providers)
CREATE TABLE IF NOT EXISTS provider_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name VARCHAR(50) UNIQUE NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  allowed_plans TEXT[] NOT NULL DEFAULT '{"all"}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
