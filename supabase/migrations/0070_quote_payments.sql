CREATE TABLE quote_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  method text NOT NULL,
  reference text,
  recorded_by uuid REFERENCES users(id),
  recorded_at timestamptz DEFAULT now(),
  notes text
);

CREATE INDEX ON quote_payments(quote_id);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
