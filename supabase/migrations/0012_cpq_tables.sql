-- 0012_cpq_tables.sql
-- Configure-Price-Quote: service catalogs, quotes, and line items.

-- Services catalog
CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  name             text NOT NULL,
  description      text,
  category         text,
  unit_price       numeric(10,2) NOT NULL DEFAULT 0,
  unit             text DEFAULT 'each',
  duration_minutes integer,
  is_active        boolean DEFAULT true,
  sort_order       integer DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_services_tenant ON services(tenant_id);
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON services FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Quotes
CREATE TABLE quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  contact_id    uuid REFERENCES contacts(id),
  quote_number  text NOT NULL,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  subtotal      numeric(10,2) DEFAULT 0,
  tax_rate      numeric(5,3) DEFAULT 0,
  tax_amount    numeric(10,2) DEFAULT 0,
  total         numeric(10,2) DEFAULT 0,
  notes         text,
  valid_until   timestamptz,
  sent_at       timestamptz,
  accepted_at   timestamptz,
  declined_at   timestamptz,
  created_by    text,
  share_token   text UNIQUE,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_quotes_tenant  ON quotes(tenant_id);
CREATE INDEX idx_quotes_contact ON quotes(contact_id);
CREATE INDEX idx_quotes_status  ON quotes(tenant_id, status);
CREATE INDEX idx_quotes_share   ON quotes(share_token);
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON quotes FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Quote line items
CREATE TABLE quote_line_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  service_id  uuid REFERENCES services(id),
  description text NOT NULL,
  quantity    numeric(10,2) NOT NULL DEFAULT 1,
  unit_price  numeric(10,2) NOT NULL DEFAULT 0,
  total       numeric(10,2) NOT NULL DEFAULT 0,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX idx_line_items_quote ON quote_line_items(quote_id);
