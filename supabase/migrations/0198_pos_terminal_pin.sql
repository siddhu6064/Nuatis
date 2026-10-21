-- 0198_pos_terminal_pin
-- PIN sign-in for a POS register. The PIN is a convenience credential for a
-- shared physical device, never a password: it is scrypt-hashed, scoped to a
-- set of locations, and the token it mints carries portalScope 'pos', which
-- requireAuth confines to /api/pos/*.

ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS pos_pin_hash text;
ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS pos_location_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_staff_members_pos_pin
  ON staff_members(tenant_id)
  WHERE pos_pin_hash IS NOT NULL;
