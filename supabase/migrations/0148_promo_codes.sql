-- ============================================================
--  0148 — Reusable, trackable promo/discount codes on quotes
--  Quotes already have a fully-wired manual discount (discount_type/value/
--  label/pct/amount, calcTotals(), CPQ approval gating) — this doesn't
--  replace that, it adds a reusable code that resolves to the same fields
--  instead of staff re-typing a number every time.
-- ============================================================

CREATE TABLE IF NOT EXISTS promo_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code               text NOT NULL,
  discount_type      text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value     numeric NOT NULL CHECK (discount_value > 0),
  max_redemptions    integer,
  redemption_count   integer NOT NULL DEFAULT 0,
  valid_from         timestamptz,
  valid_until        timestamptz,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_tenant_code
  ON promo_codes(tenant_id, upper(code));

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON promo_codes;
CREATE POLICY tenant_isolation ON promo_codes USING (tenant_id = current_tenant_id());

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL;
