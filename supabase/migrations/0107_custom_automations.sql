-- custom_automations: AI-generated automation configurations
CREATE TABLE custom_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  natural_language_prompt TEXT NOT NULL,
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('no_response', 'birthday', 'overdue_invoice', 'inactive_customer', 'new_contact', 'appointment_followup')),
  trigger_config JSONB NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL
    CHECK (action_type IN ('send_sms', 'send_email', 'create_task', 'add_tag', 'update_field', 'send_to_campaign')),
  action_config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('active', 'paused', 'draft')),
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON custom_automations(tenant_id);
CREATE INDEX ON custom_automations(tenant_id, status);
