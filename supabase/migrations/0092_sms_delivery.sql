CREATE TABLE sms_delivery_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_sid TEXT,
  error_code TEXT,
  error_title TEXT,
  to_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON sms_delivery_errors(tenant_id, created_at DESC);
CREATE INDEX ON sms_delivery_errors(error_code);
