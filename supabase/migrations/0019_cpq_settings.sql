-- CPQ settings on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cpq_settings jsonb DEFAULT '{"max_discount_pct": 20, "require_approval_above": 15, "deposit_pct": 50}';

-- Discount + approval columns on quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approval_status text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approval_note text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at timestamptz;

COMMENT ON COLUMN tenants.cpq_settings IS 'CPQ config: max_discount_pct (hard cap), require_approval_above (% threshold for owner approval), deposit_pct (Stripe deposit)';
COMMENT ON COLUMN quotes.approval_status IS 'null = no approval needed, pending = awaiting, approved = cleared to send, rejected = owner declined';
