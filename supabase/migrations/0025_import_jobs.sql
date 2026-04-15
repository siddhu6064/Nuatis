-- ============================================================
--  0025 — Import Jobs
--  Phase 8 Wk 59-60: CSV import, duplicate detection, merge
-- ============================================================

CREATE TABLE import_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  filename            TEXT NOT NULL,
  row_count           INTEGER NOT NULL DEFAULT 0,
  imported_count      INTEGER NOT NULL DEFAULT 0,
  skipped_count       INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | complete | failed
  errors              JSONB DEFAULT '[]',
  mapping             JSONB DEFAULT '{}',
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON import_jobs
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_import_jobs_tenant_time
  ON import_jobs (tenant_id, created_at DESC);
