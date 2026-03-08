-- Add 'disabled' to model_registry status constraint
ALTER TABLE model_registry DROP CONSTRAINT IF EXISTS model_registry_status_check;
ALTER TABLE model_registry ADD CONSTRAINT model_registry_status_check
  CHECK (status IN ('active', 'beta', 'deprecated', 'disabled'));
