-- 0121_stripe_billing.sql
-- Phase 9 — Stripe SaaS billing columns on tenants table.
--
-- Tracks Stripe customer/subscription identity, plan tier, trial + period
-- timing, Maya-minute usage, and the metered subscription item ID used to
-- report overage usage records back to Stripe.
--
-- All columns NULL-safe so existing tenants (pre-billing) keep working.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_plan text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maya_minutes_used int DEFAULT 0;
-- maya_minutes_limit: NULL means unlimited (Scale tier)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maya_minutes_limit int;
-- maya_overage_rate: NULL means no overage billing (Scale tier)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maya_overage_rate numeric(6,4);
-- stripe_overage_item_id: ID of the metered subscription item for usage records
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_overage_item_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email text;

-- Note: subscription_status + subscription_plan are ENUM types (defined in
-- 0001_initial_schema.sql). The new values (core/scale plan tiers,
-- 'incomplete' status) are added to those enums in
-- 0122_fix_subscription_enums.sql. CHECK constraints are not used here
-- because they conflict with the enum type definition.

-- Default unset tenants to 'trialing' for new sign-ups going forward.
ALTER TABLE tenants ALTER COLUMN subscription_status SET DEFAULT 'trialing';

-- Indexes for webhook lookups (by stripe_customer_id) and admin dashboards
-- (by subscription_status).
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON tenants(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_status
  ON tenants(subscription_status);
