-- Inbound webhook trigger for custom automations — an automation can now be
-- fired by an external system POSTing to a per-automation, unguessable URL
-- (Zapier, a customer's own script), instead of only Nuatis's own poll-based
-- triggers. The token in the URL path is the auth (same pattern as
-- trigger_links.slug / portal magic links elsewhere in this codebase) — no
-- separate signing secret, since most external senders can't custom-sign a
-- webhook request.

ALTER TABLE custom_automations
  DROP CONSTRAINT custom_automations_trigger_type_check;

ALTER TABLE custom_automations
  ADD CONSTRAINT custom_automations_trigger_type_check
  CHECK (trigger_type IN (
    'no_response',
    'birthday',
    'overdue_invoice',
    'inactive_customer',
    'new_contact',
    'appointment_followup',
    'inbound_webhook'
  ));

ALTER TABLE custom_automations
  ADD COLUMN IF NOT EXISTS inbound_webhook_token text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_automations_webhook_token
  ON custom_automations(inbound_webhook_token) WHERE inbound_webhook_token IS NOT NULL;
