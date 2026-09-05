-- Order templates — a repeat order was always built from scratch. A template
-- stores a reusable line-item shape; the order builder uses it to prefill a
-- new order (order creation itself is untouched — same insert path as today).

CREATE TABLE IF NOT EXISTS order_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  line_items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  fulfillment_type  text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_templates_tenant ON order_templates(tenant_id);

ALTER TABLE order_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON order_templates
  USING (tenant_id = current_tenant_id());
