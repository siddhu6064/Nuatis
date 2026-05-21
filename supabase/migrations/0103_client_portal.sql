-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- portal_access: maps a contact to their portal token
CREATE TABLE portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  email TEXT NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, contact_id)
);

CREATE INDEX ON portal_access(access_token);
CREATE INDEX ON portal_access(tenant_id, contact_id);

-- Portal configuration on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS portal_slug TEXT UNIQUE;
