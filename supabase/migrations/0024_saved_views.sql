-- ============================================================
--  0024 — Saved Views
--  Phase 8 Wk 57-58: contact list filtering + saved views
-- ============================================================

CREATE TABLE saved_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,  -- null = shared across tenant
  name        TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT 'contacts',
  filters     JSONB NOT NULL DEFAULT '{}',
  sort_by     TEXT,
  sort_dir    TEXT DEFAULT 'desc',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON saved_views
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_saved_views_tenant_type_order
  ON saved_views (tenant_id, object_type, sort_order);

CREATE INDEX idx_saved_views_user
  ON saved_views (user_id)
  WHERE user_id IS NOT NULL;

-- Only one default view per tenant per object_type
CREATE UNIQUE INDEX saved_views_one_default_per_tenant
  ON saved_views (tenant_id, object_type)
  WHERE is_default = true;
