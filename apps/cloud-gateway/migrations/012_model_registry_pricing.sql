-- ---------------------------------------------------------------------------
-- Migration 012: Model registry — per-model user pricing + profit bonus
-- NULL columns = fall back to legacy markup logic
-- ---------------------------------------------------------------------------

ALTER TABLE model_registry
  ADD COLUMN IF NOT EXISTS user_price_input     NUMERIC(12,6),  -- $/M tokens charged to user
  ADD COLUMN IF NOT EXISTS user_price_output    NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS purchase_price_input  NUMERIC(12,6), -- RouteBox purchase cost
  ADD COLUMN IF NOT EXISTS purchase_price_output NUMERIC(12,6),
  ADD COLUMN IF NOT EXISTS profit_bonus         NUMERIC(4,3) NOT NULL DEFAULT 0.00; -- scoring bonus

-- Kimi / Moonshot: purchase @ 70% of official, sell @ 90% → margin 28.6%
UPDATE model_registry SET
  user_price_input     = 0.90,
  user_price_output    = 2.70,
  purchase_price_input  = 0.70,
  purchase_price_output = 2.10,
  profit_bonus         = 0.06
WHERE model_id LIKE 'kimi-%' OR model_id LIKE 'moonshot-%';

-- MiniMax: purchase @ 10% of official, sell @ 90% → margin 88.9%
UPDATE model_registry SET
  user_price_input     = 0.18,
  user_price_output    = 0.18,
  purchase_price_input  = 0.02,
  purchase_price_output = 0.02,
  profit_bonus         = 0.04
WHERE model_id LIKE 'MiniMax-%';

-- GLM: purchase @ 20% of official, sell @ 80% → margin 75%
UPDATE model_registry SET
  user_price_input     = 0.40,
  user_price_output    = 0.40,
  purchase_price_input  = 0.10,
  purchase_price_output = 0.10,
  profit_bonus         = 0.03
WHERE model_id LIKE 'glm-%';
