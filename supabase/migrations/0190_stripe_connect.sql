-- Stripe Connect (Standard accounts, 2% platform fee — decisions locked with
-- the user). Additive/opt-in: a tenant that never connects keeps using the
-- shared platform Stripe account exactly as before this migration — nothing
-- breaks for existing tenants. Once a tenant connects, every NEW Stripe
-- object created for them (payment links, gift-card links, invoice links,
-- card-on-file customers/charges) is created directly on their own account
-- with an automatic application_fee_amount, so their customers' money lands
-- with them, not in Nuatis's account.
--
-- Distinct from tenants.stripe_customer_id (migration 0121) — that's
-- Nuatis-as-vendor billing (tenant pays Nuatis for their subscription), the
-- opposite direction of money flow from this. Do not conflate the two.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_status text NOT NULL DEFAULT 'none'
    CHECK (stripe_connect_status IN ('none', 'pending', 'active', 'restricted')),
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_stripe_connect_account
  ON tenants(stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;

-- A contact's Stripe Customer/PaymentMethod objects live on whichever account
-- existed at the moment they were first saved — pinned here rather than
-- re-derived from the tenant's CURRENT connect status, so a contact saved
-- before the tenant connected Stripe doesn't silently break (their objects
-- stay valid against the platform account; only new contacts saved after
-- connecting get created directly on the connected account).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;

-- Same pinning reasoning as contacts above — a payment_links row is mutated
-- later (DELETE deactivates it on Stripe), so it needs to remember which
-- account it was actually created on rather than re-deriving the tenant's
-- CURRENT connect status at deactivate time.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
