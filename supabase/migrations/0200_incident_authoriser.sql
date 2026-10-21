-- 0200_incident_authoriser
-- Who may authorise a comp above the tenant's threshold.
--
-- staff_members.role is FREE TEXT job titles — "Head Chef", "Front of House",
-- "Cashier" — not a permission model. Checking role = 'manager' matches nothing
-- in production, so authorisation needs its own explicit flag rather than
-- reading meaning into a label someone typed.
--
-- Defaults to false: nobody can authorise until a manager is deliberately
-- given the power, which is the fail-closed direction for a control that exists
-- to stop staff comping their friends' meals.
ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS pos_can_authorise boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_staff_members_pos_authoriser
  ON staff_members(tenant_id)
  WHERE pos_can_authorise;
