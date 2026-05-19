CREATE TABLE scanner_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scanner_key TEXT NOT NULL,
  paused_from TIMESTAMPTZ NOT NULL,
  paused_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_range CHECK (paused_until > paused_from)
);
CREATE INDEX ON scanner_pauses(tenant_id, scanner_key);
CREATE INDEX ON scanner_pauses(paused_until);
