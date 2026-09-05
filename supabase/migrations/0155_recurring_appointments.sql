-- Recurring appointments — a standing weekly/biweekly/monthly client is
-- generated automatically instead of rebooked by hand each time. Mirrors
-- recurring_expenses' schema/worker shape (migration 0141).

CREATE TABLE recurring_appointment_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text,
  location_id        uuid REFERENCES locations(id) ON DELETE SET NULL,
  assigned_staff_id  uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  duration_minutes   integer NOT NULL CHECK (duration_minutes > 0),
  frequency          text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  day_of_week        integer CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month       integer CHECK (day_of_month BETWEEN 1 AND 31),
  start_time         text NOT NULL, -- 'HH:MM', local to the tenant
  enabled            boolean NOT NULL DEFAULT true,
  last_generated_at  timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_appt_rules_tenant ON recurring_appointment_rules(tenant_id);
CREATE INDEX idx_recurring_appt_rules_enabled ON recurring_appointment_rules(enabled) WHERE deleted_at IS NULL;

ALTER TABLE recurring_appointment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_appointment_rules USING (tenant_id = current_tenant_id());

-- Ties a generated appointment back to the rule that created it.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurring_rule_id uuid REFERENCES recurring_appointment_rules(id) ON DELETE SET NULL;
