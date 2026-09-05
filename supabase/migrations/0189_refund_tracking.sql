-- No refund path anywhere in the payment stack (tier-1). Scoped to the two
-- payment types that have a real, retrievable processor payment id today:
-- Square quote payments (quote_payments.square_payment_id, already stored)
-- and Stripe cancellation/no-show fee charges via a contact's saved card
-- (chargeContactSavedMethod() already returns a PaymentIntent id, previously
-- discarded — this just persists it). Every other payment path — invoices,
-- gift cards, staff payment links, orders — pays via a Stripe Payment Link,
-- and a Payment Link's own metadata does not propagate to the resulting
-- Charge, so there is no reliably retrievable payment id to refund against
-- without a bigger rework of those flows. Not attempted here, not silently
-- dropped either — a real, separate, larger follow-up.

ALTER TABLE quote_payments
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'partial', 'full')),
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES users(id);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS fee_payment_intent_id text;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_fee_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_fee_status_check
  CHECK (fee_status IS NULL OR fee_status IN ('link_sent', 'charged', 'refunded'));
