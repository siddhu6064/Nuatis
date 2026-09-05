-- Recurring billing to customers — mirrors recurring_expenses' shape exactly
-- (supabase/migrations/0141_expenses.sql), the retainer/membership use case:
-- one flat recurring charge, not a full itemized invoice rebuilt each time.

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id           uuid REFERENCES deals(id) ON DELETE SET NULL,
  description       text NOT NULL,
  amount            numeric(10,2) NOT NULL,
  tax_rate          numeric(5,2) DEFAULT 0,
  due_days          integer NOT NULL DEFAULT 0,
  frequency         text NOT NULL
                      CHECK (frequency IN ('weekly','monthly','quarterly','annually')),
  day_of_week       smallint CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month      smallint CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year     smallint CHECK (month_of_year BETWEEN 1 AND 12),
  enabled           boolean NOT NULL DEFAULT true,
  last_generated_at timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_tenant ON recurring_invoices(tenant_id);

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_invoices USING (tenant_id = current_tenant_id());

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS recurring_invoice_id uuid REFERENCES recurring_invoices(id) ON DELETE SET NULL;
