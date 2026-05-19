CREATE TABLE sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  message_sid TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('queued','sent','delivered','failed','received')),
  ai_handled BOOLEAN DEFAULT false,
  ai_response TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON sms_messages(tenant_id, contact_id, created_at DESC);
CREATE INDEX ON sms_messages(tenant_id, from_number);
CREATE INDEX ON sms_messages(message_sid);
