-- Let the automation engine listen for incidents.
--
-- trigger_type is guarded by a check constraint, so an automation row naming
-- an incident trigger cannot be stored until this widens it. Dropping and
-- recreating is the only way to alter a CHECK, and re-running is safe because
-- the drop is IF EXISTS and the new constraint is created under the same name.
ALTER TABLE custom_automations
  DROP CONSTRAINT IF EXISTS custom_automations_trigger_type_check;

ALTER TABLE custom_automations
  ADD CONSTRAINT custom_automations_trigger_type_check
  CHECK (trigger_type IN (
    'no_response',
    'birthday',
    'overdue_invoice',
    'inactive_customer',
    'new_contact',
    'appointment_followup',
    'inbound_webhook',
    'incident_created',
    'incident_breached'
  ));

-- Incident automations are looked up by (tenant, trigger) on every incident
-- create and on every scanner tick, which is the one hot read this adds.
CREATE INDEX IF NOT EXISTS idx_custom_automations_tenant_trigger
  ON custom_automations(tenant_id, trigger_type)
  WHERE status = 'active';
