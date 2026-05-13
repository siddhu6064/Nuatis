-- Migration 0062: Per-tenant follow-up template overrides
CREATE TABLE IF NOT EXISTS tenant_follow_up_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK (step_index >= 0 AND step_index <= 4),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  body TEXT NOT NULL,
  subject TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, step_index, channel)
);
CREATE INDEX IF NOT EXISTS idx_follow_up_overrides_tenant
  ON tenant_follow_up_overrides (tenant_id);
ALTER TABLE tenant_follow_up_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_follow_up_overrides_tenant_isolation"
  ON tenant_follow_up_overrides
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
