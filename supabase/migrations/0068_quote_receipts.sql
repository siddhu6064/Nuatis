-- G84: Auto-receipts on quote acceptance
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS receipt_number TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ;

CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 10001;
