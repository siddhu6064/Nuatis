-- Session impersonation for Nuatis's own platform support — "log in as this
-- tenant" from Admin Console. Real read-write access (not the read-only
-- drill-down that already existed), short-lived, reason-required, and every
-- session plus every mutating request made during it is fingerprinted here:
-- which platform admin, which tenant, when, and (via impersonation_actions)
-- exactly which endpoints they hit.

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  platform_user_email text NOT NULL,
  target_tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_app_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason              text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  ended_at            timestamptz
);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_tenant ON impersonation_sessions(target_tenant_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_platform_user ON impersonation_sessions(platform_user_id);
-- No RLS tenant_isolation policy — this table is intentionally cross-tenant
-- (it belongs to the platform, not any one tenant) and only ever touched via
-- the service-role client, same as every other admin-console table access.
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_only ON impersonation_sessions USING (false);

CREATE TABLE IF NOT EXISTS impersonation_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES impersonation_sessions(id) ON DELETE CASCADE,
  method      text NOT NULL,
  path        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_impersonation_actions_session ON impersonation_actions(session_id);
ALTER TABLE impersonation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_only ON impersonation_actions USING (false);
