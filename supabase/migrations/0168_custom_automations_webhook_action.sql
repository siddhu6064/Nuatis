-- Adds 'send_webhook' as a valid action_type for custom automations, so an
-- automation can POST contact data to an external system (Zapier, a
-- customer's own endpoint) instead of only acting inside Nuatis.

ALTER TABLE custom_automations
  DROP CONSTRAINT custom_automations_action_type_check;

ALTER TABLE custom_automations
  ADD CONSTRAINT custom_automations_action_type_check
  CHECK (action_type IN (
    'send_sms',
    'send_email',
    'create_task',
    'add_tag',
    'update_field',
    'send_to_campaign',
    'send_webhook'
  ));
