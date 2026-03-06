-- 005_model_registry.sql — Model registry for scoring-engine routing
-- Stores model metadata, capability scores, and pricing for weighted routing decisions.

CREATE TABLE IF NOT EXISTS model_registry (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model_id      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  provider      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  tier          TEXT NOT NULL DEFAULT 'fast',

  -- Scores (0.0–1.0)
  quality         REAL NOT NULL DEFAULT 0.70,
  speed           REAL NOT NULL DEFAULT 0.70,
  cost_efficiency REAL NOT NULL DEFAULT 0.70,
  code_strength   REAL NOT NULL DEFAULT 0.70,

  -- Capability flags
  supports_vision         BOOLEAN NOT NULL DEFAULT false,
  supports_function_call  BOOLEAN NOT NULL DEFAULT true,
  supports_long_context   BOOLEAN NOT NULL DEFAULT false,
  chinese_optimized       BOOLEAN NOT NULL DEFAULT false,

  -- Operational parameters
  max_context_tokens  INTEGER NOT NULL DEFAULT 128000,
  avg_ttft_ms         INTEGER NOT NULL DEFAULT 500,

  -- Pricing (USD per 1M tokens)
  price_input   REAL NOT NULL DEFAULT 1.0,
  price_output  REAL NOT NULL DEFAULT 3.0,

  -- FLock marker
  is_flock_node BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry(status);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier);
CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider);

-- Seed data: all models from current MODEL_TIERS
-- Scores are initial estimates based on benchmarks and capabilities

-- ── Flagship tier ──

INSERT INTO model_registry (model_id, display_name, provider, status, tier, quality, speed, cost_efficiency, code_strength, supports_vision, supports_function_call, supports_long_context, chinese_optimized, max_context_tokens, avg_ttft_ms, price_input, price_output, is_flock_node)
VALUES
  ('gpt-4o',                          'GPT-4o',                  'OpenAI',    'active', 'flagship', 0.90, 0.70, 0.55, 0.85, true,  true, true,  false, 128000,  800,  2.50, 10.00, false),
  ('gpt-4.1',                         'GPT-4.1',                 'OpenAI',    'active', 'flagship', 0.92, 0.72, 0.60, 0.90, true,  true, true,  false, 1048576, 750,  2.00, 8.00,  false),
  ('claude-sonnet-4-20250514',        'Claude Sonnet 4',         'Anthropic', 'active', 'flagship', 0.92, 0.68, 0.50, 0.92, true,  true, true,  false, 200000,  900,  3.00, 15.00, false),
  ('gemini-2.5-pro',                  'Gemini 2.5 Pro',          'Google',    'active', 'flagship', 0.91, 0.80, 0.65, 0.88, true,  true, true,  false, 1048576, 500,  1.25, 10.00, false),
  ('MiniMax-M2.5',                    'MiniMax M2.5',            'MiniMax',   'active', 'flagship', 0.82, 0.78, 0.68, 0.75, false, true, true,  true,  1048576, 600,  0.80, 3.20,  false),
  ('kimi-k2.5',                       'Kimi K2.5',               'Kimi',      'active', 'flagship', 0.84, 0.75, 0.70, 0.80, true,  true, true,  true,  131072,  650,  0.60, 2.40,  false),
  ('kimi-k2-thinking',                'Kimi K2 Thinking',        'Kimi',      'active', 'flagship', 0.83, 0.65, 0.72, 0.78, false, true, true,  true,  131072,  800,  0.40, 1.60,  false),
  ('qwen3-235b-a22b-thinking-2507',   'Qwen3 235B Thinking',     'FLock.io',  'active', 'flagship', 0.85, 0.60, 0.72, 0.82, false, true, true,  true,  131072,  900,  0.70, 2.80,  true),

-- ── Fast tier ──

  ('gpt-4o-mini',                     'GPT-4o Mini',             'OpenAI',    'active', 'fast', 0.72, 0.88, 0.92, 0.70, true,  true,  true,  false, 128000,  300,  0.15, 0.60,  false),
  ('gpt-4.1-mini',                    'GPT-4.1 Mini',            'OpenAI',    'active', 'fast', 0.75, 0.85, 0.88, 0.72, true,  true,  true,  false, 1048576, 350,  0.40, 1.60,  false),
  ('gpt-4.1-nano',                    'GPT-4.1 Nano',            'OpenAI',    'active', 'fast', 0.60, 0.95, 0.96, 0.55, true,  true,  true,  false, 1048576, 200,  0.10, 0.40,  false),
  ('claude-haiku-4-20250514',         'Claude Haiku 4',          'Anthropic', 'active', 'fast', 0.70, 0.90, 0.85, 0.68, true,  true,  true,  false, 200000,  250,  0.80, 4.00,  false),
  ('gemini-2.5-flash',                'Gemini 2.5 Flash',        'Google',    'active', 'fast', 0.78, 0.92, 0.92, 0.75, true,  true,  true,  false, 1048576, 200,  0.15, 0.60,  false),
  ('gemini-2.0-flash',                'Gemini 2.0 Flash',        'Google',    'active', 'fast', 0.72, 0.95, 0.95, 0.70, true,  true,  true,  false, 1048576, 180,  0.075, 0.30, false),
  ('deepseek-chat',                   'DeepSeek Chat',           'DeepSeek',  'active', 'fast', 0.78, 0.80, 0.90, 0.82, false, true,  false, true,  65536,   500,  0.27, 1.10,  false),
  ('MiniMax-M2.1',                    'MiniMax M2.1',            'MiniMax',   'active', 'fast', 0.72, 0.82, 0.82, 0.65, false, true,  true,  true,  1048576, 550,  0.50, 2.00,  false),
  ('kimi-k2',                         'Kimi K2',                 'Kimi',      'active', 'fast', 0.72, 0.80, 0.85, 0.70, false, true,  true,  true,  131072,  500,  0.40, 1.60,  false),
  ('moonshot-v1-32k',                 'Moonshot v1 32K',         'Kimi',      'active', 'fast', 0.65, 0.75, 0.88, 0.55, false, false, false, true,  32768,   600,  0.34, 0.34,  false),
  ('qwen3-30b-a3b-instruct-2507',     'Qwen3 30B Instruct',      'FLock.io',  'active', 'fast', 0.72, 0.82, 0.92, 0.70, false, true,  true,  true,  131072,  400,  0.15, 0.60,  true),
  ('qwen3-30b-a3b-instruct-coding',   'Qwen3 30B Coding',        'FLock.io',  'active', 'fast', 0.70, 0.80, 0.92, 0.85, false, true,  true,  true,  131072,  400,  0.15, 0.60,  true),
  ('deepseek-v3.2',                   'DeepSeek V3.2',           'FLock.io',  'active', 'fast', 0.78, 0.78, 0.90, 0.80, false, true,  false, true,  65536,   500,  0.27, 1.10,  true)
ON CONFLICT (model_id) DO NOTHING;
