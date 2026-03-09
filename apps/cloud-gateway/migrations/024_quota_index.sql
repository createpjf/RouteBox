-- L9: Add composite index for daily_quota_usage lookups
CREATE INDEX IF NOT EXISTS idx_daily_quota_usage_lookup
  ON daily_quota_usage (user_id, quota_date, model_id);
