-- 0010_audit_log.sql
-- SOC 2 audit trail for all mutating API operations.

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       text,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text,
  details       jsonb DEFAULT '{}',
  ip_address    text,
  user_agent    text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant  ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_action  ON audit_log(tenant_id, action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON audit_log
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
