-- Cancellation/no-show fee policy — reuses the existing payment-links
-- infrastructure (createPaymentLink()) rather than building card-on-file
-- from scratch. A tenant sets a flat fee amount and, optionally, a notice
-- window (hours) under which a cancellation also counts as chargeable.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS no_show_fee_cents integer
    CHECK (no_show_fee_cents IS NULL OR no_show_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS cancellation_fee_notice_hours integer
    CHECK (cancellation_fee_notice_hours IS NULL OR cancellation_fee_notice_hours >= 0);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS fee_amount_cents integer,
  ADD COLUMN IF NOT EXISTS fee_payment_link_url text;
