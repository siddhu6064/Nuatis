-- ============================================================
--  0139 — Orders associations: quote conversion, staff, deals
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_quote ON orders (source_quote_id) WHERE source_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_assigned_staff ON orders (assigned_staff_id) WHERE assigned_staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_deal ON orders (deal_id) WHERE deal_id IS NOT NULL;
