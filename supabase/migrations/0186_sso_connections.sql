-- Enterprise SSO (SAML/OIDC) via WorkOS. A tenant admin configures one IdP
-- connection through WorkOS's own hosted Admin Portal (no SAML/OIDC parsing
-- built here) — we only store the resulting WorkOS organization id and
-- whether SSO is turned on for login. No token/secret columns needed: WorkOS
-- holds the IdP credentials, not us.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sso_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sso_domain text,
  ADD COLUMN IF NOT EXISTS workos_organization_id text UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_sso_domain ON tenants (lower(sso_domain))
  WHERE sso_domain IS NOT NULL;

-- One row per tenant (single IdP connection per tenant for v1).
CREATE TABLE IF NOT EXISTS sso_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  workos_connection_id text,
  connection_type      text CHECK (connection_type IS NULL OR connection_type IN ('saml', 'oidc')),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sso_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_connections
  USING (tenant_id = current_tenant_id());
