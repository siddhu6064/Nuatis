ALTER TABLE contacts
  ADD COLUMN sms_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.sms_opt_in IS
  'TCPA consent flag. Must be true before any SMS is sent to this
   contact. Set true by post-call.ts when Maya books an appointment
   (verbal/transactional consent). Defaults false for all contacts
   including existing rows.';
