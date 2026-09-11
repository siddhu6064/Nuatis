-- 0195_pos_menu
-- Menu model for the POS module: categories, items, modifier groups/options,
-- and the item↔group junction. Ported in shape from the KitchenPOS prototype
-- but rewritten to nuatis conventions: current_tenant_id() RLS (not the
-- auth.jwt()->'app_metadata' form) and numeric(10,2) dollars (not int cents,
-- which would clash with orders.balance_due's generated numeric column).

CREATE TABLE menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id      uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name             text NOT NULL,
  price            numeric(10,2) NOT NULL DEFAULT 0,
  taxable          boolean NOT NULL DEFAULT true,
  image_url        text,
  -- Routing key the KDS filters on. NULL = no station, shows on every screen.
  kitchen_station  text,
  available        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modifier_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  min_select  integer NOT NULL DEFAULT 0,
  max_select  integer NOT NULL DEFAULT 1,
  required    boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifier_groups_select_range CHECK (min_select <= max_select)
);

CREATE TABLE modifier_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  price_delta  numeric(10,2) NOT NULL DEFAULT 0,
  sort_order   integer NOT NULL DEFAULT 0,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_item_modifier_groups (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

CREATE INDEX idx_menu_categories_tenant ON menu_categories(tenant_id);
CREATE INDEX idx_menu_items_tenant ON menu_items(tenant_id);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_station ON menu_items(tenant_id, kitchen_station);
CREATE INDEX idx_modifier_groups_tenant ON modifier_groups(tenant_id);
CREATE INDEX idx_modifier_options_group ON modifier_options(group_id);
CREATE INDEX idx_mimg_item ON menu_item_modifier_groups(item_id);
CREATE INDEX idx_mimg_group ON menu_item_modifier_groups(group_id);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_categories USING (tenant_id = current_tenant_id());

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_items USING (tenant_id = current_tenant_id());

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_groups USING (tenant_id = current_tenant_id());

ALTER TABLE modifier_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_options USING (tenant_id = current_tenant_id());

ALTER TABLE menu_item_modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_modifier_groups USING (tenant_id = current_tenant_id());

-- ── orders adaptations ──────────────────────────────────────────────────────

-- orders.source was CHECK (source IN ('staff','maya')). A POS ticket insert
-- would fail at runtime with a constraint violation, not at build time — the
-- same failure mode as the contact_source enum bug that silently broke four
-- contact-creating routes. Widen it before any POS route writes an order.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check
  CHECK (source IN ('staff','maya','pos'));

-- A POS line references a menu item, not a CPQ service or an inventory item.
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_line_items_menu_item
  ON order_line_items(menu_item_id);

-- Chosen modifiers are snapshotted onto the line, not joined at read time, so
-- editing or deleting a modifier later never rewrites a historical ticket or
-- receipt. Shape: [{ group_id, group_name, option_id, option_name, price_delta }]
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS modifiers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Tip is recorded on the order, separate from subtotal/tax, so it can be
-- excluded from the Stripe Connect application-fee basis.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount numeric(10,2) NOT NULL DEFAULT 0;
