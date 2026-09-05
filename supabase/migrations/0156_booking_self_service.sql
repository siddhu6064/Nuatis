-- Self-service reschedule/cancel from the public booking confirmation —
-- every appointment gets an opaque, unguessable manage token (no auth
-- required to view/act on it, same trust model as a calendar-invite link).
-- booking_min_notice_hours is a per-tenant cancellation/reschedule window.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS manage_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_manage_token ON appointments(manage_token);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS booking_min_notice_hours integer NOT NULL DEFAULT 2;
