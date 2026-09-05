-- Contact card-on-file (+ ACH via Stripe's own payment-method-type
-- negotiation). One saved default payment method per contact, under the
-- platform's single Stripe account (this app has no Stripe Connect — every
-- tenant's Stripe activity already runs through one STRIPE_SECRET_KEY,
-- distinguished by tenant_id/contact_id in row data and object metadata).
-- Wired into the existing cancellation/no-show fee flow (payment-link.ts):
-- both now try an off-session charge against the saved method first, falling
-- back to the existing hosted payment-link behavior unchanged when there's no
-- saved method or the off-session charge fails (e.g. 3DS required).

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS default_payment_method_id text,
  ADD COLUMN IF NOT EXISTS default_payment_method_type text,
  ADD COLUMN IF NOT EXISTS default_payment_method_last4 text;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS fee_status text
    CHECK (fee_status IS NULL OR fee_status IN ('link_sent', 'charged'));
