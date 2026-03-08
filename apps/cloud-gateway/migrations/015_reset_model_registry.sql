-- ---------------------------------------------------------------------------
-- Migration 015: Reset model registry — replace all models with 17 new ones
-- user_price = purchase_price × 1.15 (15% margin)
-- ---------------------------------------------------------------------------

DELETE FROM model_registry;

INSERT INTO model_registry (
  model_id, display_name, provider, status, tier,
  quality, speed, cost_efficiency, code_strength,
  supports_vision, supports_function_call, supports_long_context, chinese_optimized,
  max_context_tokens, avg_ttft_ms,
  price_input, price_output,
  user_price_input, user_price_output,
  purchase_price_input, purchase_price_output,
  profit_bonus, is_flock_node
) VALUES
-- ── Flagship tier ──
('minimax-m2.5',                    'MiniMax M2.5',               'MiniMax',     'active', 'flagship', 0.82, 0.78, 0.68, 0.75, false, true,  true,  true,  1048576, 600,  0.30,  1.20,  0.345,  1.38,   0.30,  1.20,  0.04, false),
('gemini-3.1-pro-preview',          'Gemini 3.1 Pro Preview',     'FLock.io',    'active', 'flagship', 0.93, 0.75, 0.55, 0.90, true,  true,  true,  false, 1048576, 700,  2.00,  12.00, 2.30,   13.80,  2.00,  12.00, 0.03, true),
('qwen3-235b-a22b-instruct-2507',   'Qwen3 235B Instruct',        'FLock.io',    'active', 'flagship', 0.86, 0.60, 0.72, 0.83, false, true,  true,  true,  131072,  900,  0.455, 1.82,  0.523,  2.093,  0.455, 1.82,  0.05, true),
('kimi-k2-thinking',                'Kimi K2 Thinking',           'Kimi',        'active', 'flagship', 0.84, 0.65, 0.70, 0.80, false, true,  true,  true,  131072,  800,  0.60,  2.50,  0.69,   2.875,  0.60,  2.50,  0.05, false),
('kimi-k2.5',                       'Kimi K2.5',                  'Kimi',        'active', 'flagship', 0.85, 0.72, 0.65, 0.82, true,  true,  true,  true,  131072,  650,  0.60,  3.00,  0.69,   3.45,   0.60,  3.00,  0.05, false),
('openrouter/openai/gpt-5.4',       'GPT-5.4',                    'OpenRouter',  'active', 'flagship', 0.95, 0.70, 0.40, 0.92, true,  true,  true,  false, 128000,  800,  2.50,  20.00, 2.875,  23.00,  2.50,  20.00, 0.02, false),
('openrouter/anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6',   'OpenRouter',  'active', 'flagship', 0.93, 0.72, 0.48, 0.94, true,  true,  true,  false, 200000,  850,  3.00,  15.00, 3.45,   17.25,  3.00,  15.00, 0.02, false),
('openrouter/qwen/qwen3-max-thinking', 'Qwen3 Max Thinking',     'OpenRouter',  'active', 'flagship', 0.88, 0.65, 0.60, 0.85, false, true,  true,  true,  131072,  900,  0.78,  3.90,  0.897,  4.485,  0.78,  3.90,  0.03, false),
('z-ai/glm-5',                      'GLM-5',                      'z.ai',        'active', 'flagship', 0.87, 0.70, 0.58, 0.82, true,  true,  true,  true,  128000,  700,  1.00,  3.20,  1.15,   3.68,   1.00,  3.20,  0.03, false),

-- ── Fast tier ──
('minimax-m2.1',                    'MiniMax M2.1',               'MiniMax',     'active', 'fast', 0.72, 0.85, 0.88, 0.65, false, true,  true,  true,  1048576, 500,  0.27,  0.95,  0.3105, 1.0925, 0.27,  0.95,  0.04, false),
('gemini-3-flash-preview',          'Gemini 3 Flash Preview',     'FLock.io',    'active', 'fast', 0.80, 0.92, 0.85, 0.78, true,  true,  true,  false, 1048576, 250,  0.50,  3.00,  0.575,  3.45,   0.50,  3.00,  0.03, true),
('qwen3-30b-a3b-instruct-2507',     'Qwen3 30B Instruct',         'FLock.io',    'active', 'fast', 0.72, 0.85, 0.94, 0.72, false, true,  true,  true,  131072,  400,  0.07,  0.27,  0.0805, 0.3105, 0.07,  0.27,  0.05, true),
('deepseek-v3.2',                   'DeepSeek V3.2',              'FLock.io',    'active', 'fast', 0.78, 0.80, 0.92, 0.82, false, true,  false, true,  65536,   500,  0.28,  0.42,  0.322,  0.483,  0.28,  0.42,  0.05, true),
('openrouter/stepfun/step-3.5-flash', 'Step 3.5 Flash',           'OpenRouter',  'active', 'fast', 0.70, 0.92, 0.95, 0.68, false, true,  true,  true,  128000,  300,  0.10,  0.30,  0.115,  0.345,  0.10,  0.30,  0.03, false),
('z-ai/glm-4.7',                    'GLM-4.7',                    'z.ai',        'active', 'fast', 0.78, 0.82, 0.75, 0.75, true,  true,  true,  true,  128000,  500,  0.60,  2.20,  0.69,   2.53,   0.60,  2.20,  0.03, false),
('openrouter/qwen/qwen3-coder-next', 'Qwen3 Coder Next',         'OpenRouter',  'active', 'fast', 0.75, 0.88, 0.92, 0.90, false, true,  true,  true,  131072,  350,  0.12,  0.75,  0.138,  0.8625, 0.12,  0.75,  0.03, false),
('openrouter/arcee-ai/trinity-large-preview:free', 'Trinity Large Preview', 'OpenRouter', 'active', 'fast', 0.65, 0.80, 1.00, 0.60, false, true, false, false, 65536, 600, 0, 0, 0, 0, 0, 0, 0, false);
