-- G85: Tax rates on CPQ/invoices
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_rate  numeric(5,2)  DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_label text          DEFAULT 'Tax';

-- tax_rate + tax_amount already exist on quotes; only tax_label is new
ALTER TABLE quotes  ADD COLUMN IF NOT EXISTS tax_label text          DEFAULT 'Tax';
