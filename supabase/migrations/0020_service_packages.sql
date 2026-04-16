-- Service packages: bundled service offerings with discount pricing

CREATE TABLE service_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vertical            text NOT NULL,
  name                text NOT NULL,
  description         text,
  items               jsonb NOT NULL DEFAULT '[]',
  bundle_price        numeric(10,2) NOT NULL,
  bundle_discount_pct numeric(5,2),
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_packages_tenant_vertical ON service_packages(tenant_id, vertical, is_active);

ALTER TABLE service_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON service_packages
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Add package_id to quote_line_items for tracking which items belong to a package
ALTER TABLE quote_line_items ADD COLUMN package_id uuid REFERENCES service_packages(id) ON DELETE SET NULL;
CREATE INDEX idx_line_items_package ON quote_line_items(package_id) WHERE package_id IS NOT NULL;
