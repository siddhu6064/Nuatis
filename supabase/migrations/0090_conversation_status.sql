CREATE TABLE conversation_status (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, contact_id)
);
CREATE INDEX ON conversation_status(tenant_id, resolved_at);
