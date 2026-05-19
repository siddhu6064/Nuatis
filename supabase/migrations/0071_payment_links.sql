CREATE TABLE payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  stripe_link_id text NOT NULL,
  url text NOT NULL,
  amount numeric(10,2) NOT NULL,
  description text NOT NULL,
  label text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX ON payment_links(tenant_id);
