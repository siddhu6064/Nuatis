-- ============================================================
--  0048 — Inventory items
--  Phase 11 Wk 87-88: inventory tracking + reorder alerts
-- ============================================================

CREATE TABLE inventory_items (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  sku                         text,
  quantity                    numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_threshold           numeric NOT NULL DEFAULT 5 CHECK (reorder_threshold >= 0),
  unit_cost                   numeric CHECK (unit_cost >= 0),
  unit                        text NOT NULL DEFAULT 'each'
                                CHECK (unit IN ('each','box','kg','L','bag','roll','other')),
  supplier                    text,
  notes                       text,
  last_low_stock_notified_at  timestamptz,
  deleted_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inventory_items
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_inventory_items_tenant_active
  ON inventory_items (tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_inventory_items_tenant_quantity
  ON inventory_items (tenant_id, quantity) WHERE deleted_at IS NULL;

-- Reuse set_updated_at() from 0001_initial_schema.sql
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
