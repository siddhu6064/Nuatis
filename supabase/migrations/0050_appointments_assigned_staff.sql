-- ============================================================
--  0050 — appointments.assigned_staff_id
--  Phase 11 Wk 91-92: staff scheduling — appointment assignment
--
--  NOTE: Wk 89-90 spec asserted that 0049 added this column.
--  It did not. Adding it here as a standalone migration.
-- ============================================================

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid
    REFERENCES staff_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_staff
  ON appointments (tenant_id, assigned_staff_id)
  WHERE assigned_staff_id IS NOT NULL;

COMMENT ON COLUMN appointments.assigned_staff_id IS
  'Staff member assigned to fulfill this appointment. NULL means "any available".';
