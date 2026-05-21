-- telnyx_numbers: multiple phone numbers per tenant with department routing
CREATE TABLE telnyx_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'general'
    CHECK (department IN ('general', 'scheduling', 'billing', 'sales', 'support', 'maya')),
  is_primary BOOLEAN DEFAULT false,
  maya_enabled BOOLEAN DEFAULT true,
  telnyx_connection_id TEXT,
  forwarding_number TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON telnyx_numbers(tenant_id);
CREATE INDEX ON telnyx_numbers(phone_number);
CREATE UNIQUE INDEX ON telnyx_numbers(tenant_id) WHERE is_primary = true;

-- Migrate existing telnyx_number from locations to telnyx_numbers table
INSERT INTO telnyx_numbers (tenant_id, location_id, phone_number, label, department, is_primary, maya_enabled)
SELECT
  tenant_id, id, telnyx_number, 'Main Number', 'general', true, maya_enabled
FROM locations
WHERE telnyx_number IS NOT NULL
ON CONFLICT (phone_number) DO NOTHING;
