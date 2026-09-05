-- Single-shot dunning fix — invoice.payment_failed always sent the identical
-- email regardless of how many times it had already fired. A per-tenant
-- counter lets the email escalate (notice → warning → final notice) and
-- resets to 0 the moment a payment actually succeeds.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS payment_failure_count integer NOT NULL DEFAULT 0;
