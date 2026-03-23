-- ============================================================
-- Migration 0002: Auth provider support + vertical_configs table
-- ============================================================

-- 1. Add auth_provider to tenants (clerk for demo, authjs for all customers)
ALTER TABLE tenants
  ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'authjs'
    CHECK (auth_provider IN ('clerk', 'authjs')),
  ALTER COLUMN clerk_org_id DROP NOT NULL;

-- 2. Make clerk_user_id nullable on users (authjs users won't have one)
ALTER TABLE users
  ALTER COLUMN clerk_user_id DROP NOT NULL,
  ADD COLUMN authjs_user_id TEXT UNIQUE;

-- Ensure at least one auth ID exists per user
ALTER TABLE users
  ADD CONSTRAINT user_has_auth_id
    CHECK (clerk_user_id IS NOT NULL OR authjs_user_id IS NOT NULL);

-- 3. vertical_configs table — the engine that drives all dynamic fields
CREATE TABLE vertical_configs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vertical_slug TEXT NOT NULL,
  field_definitions   JSONB NOT NULL DEFAULT '[]',
  system_prompt_template TEXT,
  pipeline_stages_seed   JSONB NOT NULL DEFAULT '[]',
  message_templates      JSONB NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, vertical_slug)
);

ALTER TABLE vertical_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vertical_configs
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_vertical_configs_tenant ON vertical_configs(tenant_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON vertical_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Update schema version
INSERT INTO schema_versions (version, description)
VALUES ('1.0.1', 'Auth provider column, nullable clerk fields, vertical_configs table');
