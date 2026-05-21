-- referral_codes: unique referral links for each tenant
CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  clicks INTEGER DEFAULT 0,
  signups INTEGER DEFAULT 0,
  commission_rate NUMERIC(4,2) DEFAULT 10.00,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON referral_codes(tenant_id);
CREATE INDEX ON referral_codes(code);

-- referral_signups: tracks tenants who signed up via referral link
CREATE TABLE referral_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  referring_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  referred_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed_up'
    CHECK (status IN ('signed_up', 'active', 'churned', 'paid')),
  commission_amount NUMERIC(10,2),
  signed_up_at TIMESTAMPTZ DEFAULT now(),
  activated_at TIMESTAMPTZ,
  first_payment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON referral_signups(referring_tenant_id);
CREATE INDEX ON referral_signups(referral_code_id);
