-- ============================================================
--  0146 — Customer-refers-a-friend program
--  Separate from referral_codes/referral_signups (Nuatis's own
--  tenant-affiliate "Refer & Earn" feature, referrals.ts, untouched here) —
--  this is an SMB tenant's own end customers referring their friends to
--  the tenant. Reuses contacts.referred_by_contact_id for attribution and
--  gift_cards for the reward.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_referral_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  clicks      integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_referral_codes_contact
  ON contact_referral_codes(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_referral_codes_code
  ON contact_referral_codes(code);

ALTER TABLE contact_referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON contact_referral_codes;
CREATE POLICY tenant_isolation ON contact_referral_codes USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS customer_referral_rewards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referrer_contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  referred_contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_type           text NOT NULL CHECK (trigger_type IN ('appointment', 'order')),
  trigger_appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  trigger_order_id       uuid REFERENCES orders(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'failed')),
  referrer_gift_card_id  uuid REFERENCES gift_cards(id) ON DELETE SET NULL,
  referred_gift_card_id  uuid REFERENCES gift_cards(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  issued_at              timestamptz
);

-- ONE reward per referred contact, ever — the idempotency guarantee. Both
-- appointments.ts and orders.ts enqueue a job on every completion; the
-- worker races an insert against this unique index and the loser (23505)
-- is a silent no-op — this is what "first booking or purchase, whichever
-- happens first" means operationally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_referral_rewards_referred
  ON customer_referral_rewards(referred_contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_referral_rewards_tenant
  ON customer_referral_rewards(tenant_id, status);

ALTER TABLE customer_referral_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_referral_rewards;
CREATE POLICY tenant_isolation ON customer_referral_rewards USING (tenant_id = current_tenant_id());

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_referral_program_enabled boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_referral_reward_cents integer DEFAULT 1000;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_referral_referred_reward_cents integer DEFAULT 0;
