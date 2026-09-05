-- Tier 2 of "The Next Big Thing" plan: outward integration platform.
--
-- Scoping research found the core of this already built (migration 0007,
-- very early in the project): webhook_subscriptions table, full CRUD at
-- /api/webhooks (apps/api/src/routes/webhooks.ts), and lib/webhook-dispatcher.ts
-- already HMAC-signs and fires 8 real event types from 5 different files. It
-- was simply never exposed anywhere in the product UI — a tenant had no way
-- to ever create a subscription. Real gaps this migration supports: no
-- delivery log (a failed send just vanished, forever, with no record), and
-- no API-key auth path for managing subscriptions outside a browser session.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id    uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt_count      integer NOT NULL DEFAULT 0,
  last_attempted_at  timestamptz,
  response_status    integer,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries(status) WHERE status = 'pending';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries USING (tenant_id = current_tenant_id());

-- Tenant-scoped API keys — a narrow developer-facing auth mechanism for the
-- existing /api/webhooks management endpoints only (list/create/delete a
-- subscription via script or infra-as-code), not a general CRM data API.
-- Only the hash is stored; the plaintext key is shown once, at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  key_hash            text NOT NULL,
  key_prefix          text NOT NULL,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_active ON api_keys(tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys USING (tenant_id = current_tenant_id());
