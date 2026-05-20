CREATE TABLE square_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  square_merchant_id TEXT NOT NULL,
  square_location_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

ALTER TABLE quote_payments ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe'
  CHECK (provider IN ('stripe', 'square', 'cash', 'check', 'other'));
ALTER TABLE quote_payments ADD COLUMN IF NOT EXISTS square_payment_id TEXT;
