-- Deal line items — a deal's value was a single manual number with no way
-- to itemize what's actually being sold. Mirrors invoice_line_items' shape
-- (supabase/migrations/0097_invoices.sql) — a GENERATED amount column and
-- tenant_id directly on the line-item row, not just reachable via the
-- parent. Line items are optional: a deal with none keeps working exactly
-- as before, with `value` set manually.

CREATE TABLE IF NOT EXISTS deal_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric(10,2) NOT NULL DEFAULT 1,
  unit_price  numeric(10,2) NOT NULL DEFAULT 0,
  amount      numeric(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_line_items_deal ON deal_line_items(deal_id);

ALTER TABLE deal_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deal_line_items
  USING (tenant_id = current_tenant_id());
