-- ============================================================
--  0138 — Orders: order management (header, line items, payments)
-- ============================================================

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id            uuid REFERENCES contacts(id) ON DELETE SET NULL,
  order_number          text NOT NULL,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','in_progress','ready','completed','cancelled')),
  source                text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','maya')),
  customer_name         text,
  customer_phone        text,
  fulfillment_type      text CHECK (fulfillment_type IN ('pickup','delivery','dine_in')),
  requested_ready_time  timestamptz,
  subtotal              numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate              numeric(5,2) DEFAULT 0,
  tax_amount            numeric(10,2) DEFAULT 0,
  total                 numeric(10,2) NOT NULL DEFAULT 0,
  payment_status        text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  amount_paid           numeric(10,2) NOT NULL DEFAULT 0,
  balance_due           numeric(10,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
  notes                 text,
  confirmed_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_line_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id         uuid REFERENCES services(id) ON DELETE SET NULL,
  inventory_item_id  uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  description        text NOT NULL,
  quantity           numeric(10,2) NOT NULL DEFAULT 1,
  unit_price         numeric(10,2) NOT NULL DEFAULT 0,
  total              numeric(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes              text,
  sort_order         integer DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount       numeric(10,2) NOT NULL,
  method       text NOT NULL,
  reference    text,
  recorded_by  uuid REFERENCES users(id),
  recorded_at  timestamptz DEFAULT now(),
  notes        text
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS order_counter integer DEFAULT 1000;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders USING (tenant_id = current_tenant_id());

ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_line_items USING (tenant_id = current_tenant_id());

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_payments USING (tenant_id = current_tenant_id());

CREATE INDEX idx_orders_tenant_active    ON orders (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_tenant_status    ON orders (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_contact          ON orders (contact_id);
CREATE INDEX idx_order_line_items_order  ON order_line_items (order_id);
CREATE INDEX idx_order_line_items_tenant ON order_line_items (tenant_id);
CREATE INDEX idx_order_payments_order    ON order_payments (order_id);

-- Reuse set_updated_at() from 0001_initial_schema.sql
CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
