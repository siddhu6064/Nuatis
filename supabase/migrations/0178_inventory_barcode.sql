ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_tenant_barcode
  ON inventory_items (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
