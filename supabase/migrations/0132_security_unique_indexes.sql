-- P3 security hardening: tenant-scoped uniqueness + webhook idempotency.
-- MUST be applied before/with the matching application code deploy (the new
-- upsert onConflict targets and the invoice dedup check rely on these).

-- ── MASS-01: push subscription uniqueness must be scoped to tenant ────────────
-- Previously `endpoint` / `expo_token` were globally UNIQUE, so tenant A could
-- upsert (and overwrite) a row owned by tenant B.

ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_tenant_endpoint_idx
  ON push_subscriptions (tenant_id, endpoint);

ALTER TABLE mobile_push_tokens DROP CONSTRAINT IF EXISTS mobile_push_tokens_expo_token_key;
CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_tokens_tenant_expo_token_idx
  ON mobile_push_tokens (tenant_id, expo_token);

-- ── DUP-01: Stripe invoice idempotency ───────────────────────────────────────
-- A replayed `invoice.payment_succeeded` inside Stripe's timestamp tolerance
-- window would insert a duplicate invoice row. Track the Stripe invoice id and
-- enforce uniqueness so the webhook handler can skip already-processed events.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_invoice_id text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_stripe_invoice_id_idx
  ON invoices (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
