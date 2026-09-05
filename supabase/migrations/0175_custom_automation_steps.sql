-- Multi-step / branching custom automations — every automation today is
-- strictly one trigger -> one action. This adds OPTIONAL additional steps
-- after the existing (AI-generated) first action, each with its own delay
-- and an optional skip-condition. An automation with zero rows here behaves
-- exactly as it always has — this is additive, not a rework of the base
-- trigger/action columns on custom_automations.
--
-- Mirrors outreach_sequence_steps / outreach_sequence_enrollments' shape
-- (0174_outreach_sequences.sql) almost exactly: an ordered per-automation
-- steps table + a per-contact progress-cursor enrollment table.

CREATE TABLE IF NOT EXISTS custom_automation_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id   uuid NOT NULL REFERENCES custom_automations(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_order      integer NOT NULL,
  delay_days      integer NOT NULL DEFAULT 0,
  action_type     text NOT NULL CHECK (action_type IN (
                     'send_sms', 'send_email', 'create_task', 'add_tag',
                     'update_field', 'send_to_campaign', 'send_webhook'
                   )),
  action_config   jsonb,
  -- Optional skip-condition, evaluated against the contact row at run time.
  -- When present and false, this step's action is skipped but the
  -- enrollment still advances past it (a real, if simple, branch).
  condition_field text,
  condition_op    text CHECK (condition_op IN ('eq', 'neq', 'contains', 'exists')),
  condition_value text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_automation_steps_automation
  ON custom_automation_steps(automation_id, step_order);

-- One active enrollment per (automation, contact) — mirrors
-- outreach_sequence_enrollments' UNIQUE constraint and re-enroll semantics.
CREATE TABLE IF NOT EXISTS custom_automation_enrollments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES custom_automations(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  last_step_at  timestamptz,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_automation_enrollments_active
  ON custom_automation_enrollments(tenant_id, status);

ALTER TABLE custom_automation_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_automation_steps USING (tenant_id = current_tenant_id());

ALTER TABLE custom_automation_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_automation_enrollments USING (tenant_id = current_tenant_id());
