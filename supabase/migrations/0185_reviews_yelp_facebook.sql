-- Read-only Yelp review import + a Facebook OAuth review-sync scaffold. Both
-- write into the existing reviews table (source='yelp'/'facebook', already
-- valid per migration 0179) — no schema change needed there. These are two
-- new *connection* tables, since gbp_connections is Google-only by
-- construction (UNIQUE(tenant_id), no provider discriminator).
--
-- Yelp: app-level API key (YELP_API_KEY), not OAuth — a tenant just links
-- their Yelp business id. Facebook: real OAuth, built structurally complete,
-- but won't do anything until real META_APP_ID/META_APP_SECRET credentials
-- exist — this table sits unused until then.

CREATE TABLE IF NOT EXISTS yelp_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  yelp_business_id text NOT NULL,
  business_name   text,
  connected_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE yelp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON yelp_connections
  USING (tenant_id = current_tenant_id());

-- access_token is encrypted at rest (AES-256-GCM via lib/email-oauth.ts's
-- existing encryptToken/decryptToken, reused rather than duplicated) —
-- unlike gbp_connections, which stores tokens in plaintext. Facebook Page
-- tokens are long-lived and higher-value, so this table follows the more
-- correct precedent already established for email OAuth instead.
CREATE TABLE IF NOT EXISTS facebook_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  facebook_page_id  text NOT NULL,
  page_name         text,
  access_token      text NOT NULL,
  token_expires_at  timestamptz,
  connected_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE facebook_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON facebook_connections
  USING (tenant_id = current_tenant_id());
