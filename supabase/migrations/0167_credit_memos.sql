-- Credit memos on invoices — no first-class way to record an overpayment or
-- correction; only a real payment could reduce balance_due. A credit memo
-- reduces the balance the exact same way a payment does (via amount_paid,
-- since balance_due is a generated column) but is tracked as its own kind of
-- record for reporting, not conflated with cash actually received.

CREATE TABLE IF NOT EXISTS credit_memos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  reason      text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_memos_tenant_invoice ON credit_memos(tenant_id, invoice_id);

ALTER TABLE credit_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON credit_memos
  USING (tenant_id = current_tenant_id());
