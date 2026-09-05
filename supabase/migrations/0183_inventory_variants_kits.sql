-- Inventory variants (e.g. a T-shirt in S/M/L) and kits (a bundle assembled
-- from other inventory_items, e.g. a gift basket). Both are modeled as
-- ordinary inventory_items rows with extra relational metadata, deliberately
-- NOT a parallel storage model — every existing consumer (list, search,
-- low-stock scanner, movement history, barcode lookup) already works
-- unchanged for variants/kits, since each variant/kit is still just one row
-- with its own quantity/reorder_threshold/sku/barcode.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_label text;

CREATE INDEX IF NOT EXISTS idx_inventory_items_parent
  ON inventory_items(parent_item_id) WHERE parent_item_id IS NOT NULL;

-- Kit recipe: what components + quantities make one of the kit item.
-- Kit quantity itself is a real, storable count of PRE-BUILT/assembled kits
-- on hand (like any other item) — building more via POST /:id/build decrements
-- components and increments the kit's own quantity; it is not a live-computed
-- field, so it behaves identically to a normal item everywhere else in the app.
CREATE TABLE IF NOT EXISTS inventory_kit_components (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kit_item_id        uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  component_item_id  uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity           numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_item_id, component_item_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_kit_components_kit
  ON inventory_kit_components(kit_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_kit_components_tenant
  ON inventory_kit_components(tenant_id);

ALTER TABLE inventory_kit_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_kit_components
  USING (tenant_id = current_tenant_id());
