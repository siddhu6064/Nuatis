-- 0009_push_subscriptions.sql
-- Store Web Push subscription endpoints per tenant/user.

CREATE TABLE push_subscriptions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id   text,
  endpoint  text NOT NULL UNIQUE,
  p256dh    text NOT NULL,
  auth      text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_push_subs_tenant ON push_subscriptions(tenant_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON push_subscriptions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
