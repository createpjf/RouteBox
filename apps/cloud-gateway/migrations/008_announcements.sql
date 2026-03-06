-- ---------------------------------------------------------------------------
-- Migration 008: Announcements system
-- Admin-managed banners displayed to desktop users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  message    text NOT NULL,
  type       text NOT NULL DEFAULT 'info',  -- info | warning | error
  starts_at  timestamptz DEFAULT now(),
  ends_at    timestamptz,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active, starts_at, ends_at);
