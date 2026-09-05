-- ============================================================
--  0141 — Expenses: expense tracking, categories, recurring rules
-- ============================================================

CREATE TABLE IF NOT EXISTS expense_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);
-- Mirrors pipeline_stages' shape deliberately: tenant-owned freeform list,
-- created_at only, no updated_at/trigger.

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id         uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount              numeric(10,2) NOT NULL,
  vendor              text,
  notes               text,
  frequency           text NOT NULL
                        CHECK (frequency IN ('weekly','monthly','quarterly','annually')),
  day_of_week         smallint CHECK (day_of_week BETWEEN 0 AND 6),    -- weekly
  day_of_month        smallint CHECK (day_of_month BETWEEN 1 AND 31),  -- monthly/quarterly/annually
  month_of_year       smallint CHECK (month_of_year BETWEEN 1 AND 12), -- annually only
  enabled             boolean NOT NULL DEFAULT true,
  last_generated_at   timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id           uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  recurring_expense_id  uuid REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  expense_number        text NOT NULL,
  amount                numeric(10,2) NOT NULL,
  expense_date          date NOT NULL DEFAULT CURRENT_DATE,
  vendor                text,
  notes                 text,
  receipt_storage_path  text,
  receipt_filename      text,
  receipt_file_type     text,
  receipt_file_size     integer,
  created_by            uuid REFERENCES users(id),
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS expense_counter integer DEFAULT 1000;

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expense_categories USING (tenant_id = current_tenant_id());
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_expenses USING (tenant_id = current_tenant_id());
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant   ON expense_categories (tenant_id) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_tenant   ON recurring_expenses (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_due_scan ON recurring_expenses (enabled) WHERE enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_active      ON expenses (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date        ON expenses (tenant_id, expense_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category           ON expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_recurring          ON expenses (recurring_expense_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
