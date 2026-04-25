-- Add vertical column to inventory_items and staff_members
-- Allows per-vertical filtering in multi-vertical demo tenant
-- NULL = show for all verticals (single-vertical tenants)

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS vertical text;

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS vertical text;

CREATE INDEX IF NOT EXISTS idx_inventory_items_vertical
  ON inventory_items (tenant_id, vertical)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_members_vertical
  ON staff_members (tenant_id, vertical)
  WHERE is_active = true;
