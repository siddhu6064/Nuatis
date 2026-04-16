-- Calendar provider tracking on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS calendar_provider TEXT CHECK (calendar_provider IN ('google', 'outlook'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outlook_calendar_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outlook_calendar_refresh_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outlook_calendar_token_expires_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS outlook_calendar_email TEXT;

-- Compliance fields on contacts (vertical-specific JSONB)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS compliance_fields JSONB DEFAULT '{}';

-- Territory on contacts + locations
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS territory TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS territory TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_territory ON contacts(tenant_id, territory);
