-- Reverts 0191_demo_vertical_tags.sql (never actually needed — turns out
-- staff_members.vertical and inventory_items.vertical already existed,
-- were already fully populated for every demo-tenant row, and the shared
-- staff.ts/inventory.ts list routes already filter by them. This
-- demo_vertical column duplicated that pre-existing mechanism under a
-- different name; dropping it to avoid two parallel, confusingly similar
-- vertical-tag columns sitting on the same tables.
ALTER TABLE staff_members DROP COLUMN IF EXISTS demo_vertical;
ALTER TABLE inventory_items DROP COLUMN IF EXISTS demo_vertical;
