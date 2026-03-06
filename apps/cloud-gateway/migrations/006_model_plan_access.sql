-- ---------------------------------------------------------------------------
-- Migration 006: Add allowed_plans to model_registry
-- Allows per-model plan access control (free / pro / all)
-- ---------------------------------------------------------------------------

ALTER TABLE model_registry
  ADD COLUMN IF NOT EXISTS allowed_plans text[] NOT NULL DEFAULT ARRAY['all'];
