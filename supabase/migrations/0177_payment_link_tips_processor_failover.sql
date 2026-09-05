ALTER TABLE payment_links ALTER COLUMN stripe_link_id DROP NOT NULL;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS tip_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS processor text NOT NULL DEFAULT 'stripe' CHECK (processor IN ('stripe', 'square')),
  ADD COLUMN IF NOT EXISTS square_payment_link_id text;
