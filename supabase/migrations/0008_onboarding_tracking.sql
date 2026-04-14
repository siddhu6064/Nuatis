-- 0008_onboarding_tracking.sql
-- Track onboarding completion status per tenant.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 1;

COMMENT ON COLUMN tenants.onboarding_completed IS 'True when tenant has completed the onboarding wizard';
COMMENT ON COLUMN tenants.onboarding_step IS 'Current onboarding wizard step (1-6)';
