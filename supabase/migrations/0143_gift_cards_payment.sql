-- ============================================================
--  0143 — Gift cards: require a payment method on issuance
--  Previously POST /api/gift-cards just inserted a row with a full balance —
--  no payment captured. Online (stripe) purchases now start 'pending_payment'
--  and only activate once the Payment Link is paid (checkout.session.completed).
-- ============================================================

ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check
  CHECK (status IN ('active', 'redeemed', 'expired', 'cancelled', 'pending_payment'));

ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash', 'card', 'stripe', 'other'));
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS stripe_payment_link_id text;
