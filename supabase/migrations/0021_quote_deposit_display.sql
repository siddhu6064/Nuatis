-- Deposit display columns on quotes (config-only, no payment processing)

-- Snapshot of tenant deposit_pct at time quote is sent
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_pct numeric(5,2);

-- Computed on send: quote.total * (deposit_pct / 100)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2);

-- Computed on send: quote.total - deposit_amount
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS remaining_balance numeric(10,2);
