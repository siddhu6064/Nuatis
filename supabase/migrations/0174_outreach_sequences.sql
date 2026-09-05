-- Outreach sequences/cadences — tenant-editable multi-step nurture, distinct
-- from the existing per-vertical hardcoded follow_up_cadence (packages/shared
-- verticals) which only auto-enrolls a brand-new contact with no appointment.
-- This is for a staff member to manually enroll ANY contact into a
-- tenant-defined sequence. Step shape mirrors FollowUpStep exactly
-- (days_after/channel/subject/template) so the worker logic in
-- follow-up-cadence-worker.ts could be forked directly rather than reinvented.

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outreach_sequence_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_order   integer NOT NULL,
  days_after   integer NOT NULL DEFAULT 0,
  channel      text NOT NULL CHECK (channel IN ('sms', 'email')),
  subject      text,
  template     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_sequence_steps_sequence
  ON outreach_sequence_steps(sequence_id, step_order);

-- One active enrollment per (sequence, contact) — re-enrolling after
-- completion/stop is a status flip back to 'active' with current_step reset,
-- not a second row.
CREATE TABLE IF NOT EXISTS outreach_sequence_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id   uuid NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  last_sent_at  timestamptz,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_enrollments_active
  ON outreach_sequence_enrollments(tenant_id, status);

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outreach_sequences USING (tenant_id = current_tenant_id());

ALTER TABLE outreach_sequence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outreach_sequence_steps USING (tenant_id = current_tenant_id());

ALTER TABLE outreach_sequence_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outreach_sequence_enrollments USING (tenant_id = current_tenant_id());
