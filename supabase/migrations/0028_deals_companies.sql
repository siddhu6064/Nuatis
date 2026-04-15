-- ============================================================
--  0028 — Companies + Deals
--  Phase 8 Wk 65-66: deals kanban, companies, pipeline forecast
-- ============================================================

-- ── COMPANIES ───────────────────────────────────────────────

CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  domain          TEXT,
  industry        TEXT,
  employee_count  INTEGER,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  website         TEXT,
  notes           TEXT,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON companies
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_companies_tenant_active
  ON companies (tenant_id, is_archived, created_at DESC);

CREATE INDEX idx_companies_tenant_name
  ON companies (tenant_id, name);

CREATE OR REPLACE FUNCTION update_companies_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_companies_updated_at();


-- ── CONTACTS: add company_id FK ─────────────────────────────

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_id
  ON contacts(company_id) WHERE company_id IS NOT NULL;


-- ── DEALS ───────────────────────────────────────────────────

CREATE TABLE deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id          UUID REFERENCES companies(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  value               NUMERIC(12,2) DEFAULT 0,
  pipeline_stage_id   UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  close_date          DATE,
  probability         INTEGER DEFAULT 50 CHECK (probability >= 0 AND probability <= 100),
  notes               TEXT,
  is_closed_won       BOOLEAN NOT NULL DEFAULT false,
  is_closed_lost      BOOLEAN NOT NULL DEFAULT false,
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deals
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_deals_tenant_stage
  ON deals (tenant_id, is_archived, pipeline_stage_id);

CREATE INDEX idx_deals_tenant_contact
  ON deals (tenant_id, contact_id);

CREATE INDEX idx_deals_tenant_close
  ON deals (tenant_id, close_date) WHERE close_date IS NOT NULL;

CREATE OR REPLACE FUNCTION update_deals_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_deals_updated_at();


-- ── Module flags for B2B verticals ──────────────────────────

UPDATE tenants SET modules = COALESCE(modules, '{}'::jsonb) || '{"companies": true, "deals": true}'::jsonb
WHERE vertical IN ('contractor', 'law_firm', 'real_estate', 'sales_crm');
