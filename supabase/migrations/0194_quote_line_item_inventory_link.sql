-- quotes.ts's inventory-auto-deduct-on-accept logic (P11) has always queried
-- quote_line_items.inventory_item_id, but no prior migration ever created
-- this column on quote_line_items (unlike order_line_items/purchase_order_items,
-- which do have it, from 0138/0150) — that deduction has been a silent no-op
-- since it shipped (wrapped in try/catch, so the 42703 was swallowed).
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;
