-- 0007_webhook_subscriptions.sql
-- Tenant webhook subscriptions for Zapier/Make integration.

CREATE TABLE webhook_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  url         text NOT NULL,
  event_types text[] NOT NULL,
  is_active   boolean DEFAULT true,
  secret      text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_webhook_subs_tenant ON webhook_subscriptions(tenant_id);

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation"
  ON webhook_subscriptions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
