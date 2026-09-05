-- Referral commission payout: links a referral_signups row to the actual
-- tenant that resulted from it (previously tracked only by email, with no
-- connection to a real account), and adds the "paid" timestamp the existing
-- status enum already allowed but nothing ever wrote.

ALTER TABLE referral_signups
  ADD COLUMN IF NOT EXISTS referred_tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- One referral credit per referred tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_signups_tenant
  ON referral_signups(referred_tenant_id) WHERE referred_tenant_id IS NOT NULL;
