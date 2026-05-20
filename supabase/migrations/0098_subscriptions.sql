CREATE TABLE client_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  interval TEXT NOT NULL CHECK (interval IN ('weekly', 'monthly', 'quarterly', 'annually')),
  interval_count INTEGER DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled', 'past_due', 'incomplete')),
  stripe_price_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON client_subscriptions(tenant_id, status);
CREATE INDEX ON client_subscriptions(contact_id);
CREATE INDEX ON client_subscriptions(stripe_subscription_id);
