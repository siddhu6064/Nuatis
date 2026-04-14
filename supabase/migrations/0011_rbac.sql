-- 0011_rbac.sql
-- Multi-user RBAC foundation for SOC 2 compliance.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id text;

CREATE TABLE tenant_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    text NOT NULL,
  role       text NOT NULL DEFAULT 'member',
  email      text,
  name       text,
  is_active  boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user   ON tenant_users(user_id);

ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON tenant_users
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
