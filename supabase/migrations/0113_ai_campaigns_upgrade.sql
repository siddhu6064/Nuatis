-- 0113_ai_campaigns_upgrade.sql
-- P13 AI Campaigns module: extend existing campaigns table with AI-native columns,
-- add multi-channel support, objective taxonomy, and tenant RLS.

-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS objective    text,
  ADD COLUMN IF NOT EXISTS segment_id   uuid REFERENCES smart_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channels     text[] NOT NULL DEFAULT '{sms}',
  ADD COLUMN IF NOT EXISTS schedule_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contact_count integer;

-- Update status check to include P13 values (running, complete) alongside legacy
-- Drop old constraint first; recreate with full union of allowed values
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'running', 'complete', 'paused', 'cancelled', 'sending', 'sent'));

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id
  ON campaigns(tenant_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns(tenant_id, status);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON campaigns
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
