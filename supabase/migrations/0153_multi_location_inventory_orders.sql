-- Multi-location inventory/orders — MVP scope: an item or order can
-- optionally be tagged to one of the tenant's existing `locations` rows.
-- Nullable and backward-compatible: existing rows (location_id NULL) stay
-- visible tenant-wide, exactly as before. Does NOT decouple per-location
-- stock counts for the same SKU (that would need a separate
-- inventory_stock join table) — deliberately deferred, see plan notes.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_location ON orders(location_id);
