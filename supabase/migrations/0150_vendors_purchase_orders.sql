-- Vendor / purchase-order management for the Inventory module.
-- Greenfield — no prior vendor/PO concept existed; inventory_items.supplier
-- stays a free-text field, untouched.

CREATE TABLE vendors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendors_tenant ON vendors(tenant_id);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendors USING (tenant_id = current_tenant_id());

CREATE TABLE purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  po_number       text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
  expected_date   date,
  notes           text,
  subtotal        numeric(10,2) NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at         timestamptz,
  received_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_purchase_orders_tenant_number ON purchase_orders(tenant_id, po_number);
CREATE INDEX idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status);
CREATE INDEX idx_purchase_orders_vendor ON purchase_orders(vendor_id);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders USING (tenant_id = current_tenant_id());

CREATE TABLE purchase_order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id   uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  description         text NOT NULL,
  quantity_ordered    integer NOT NULL CHECK (quantity_ordered > 0),
  quantity_received   integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_cost           numeric(10,2) NOT NULL DEFAULT 0,
  total                numeric(10,2) GENERATED ALWAYS AS (quantity_ordered * unit_cost) STORED,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_po_items_tenant ON purchase_order_items(tenant_id);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_items USING (tenant_id = current_tenant_id());

-- Mirrors tenants.order_counter's select-then-increment pattern (see
-- lib/order-number.ts) for PO-NNNN numbering.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS po_counter integer NOT NULL DEFAULT 1000;
