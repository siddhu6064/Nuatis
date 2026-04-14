-- 0006_follow_up_tracking.sql
-- Add follow-up cadence tracking columns to contacts table.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS follow_up_step integer DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS follow_up_last_sent timestamptz;

COMMENT ON COLUMN contacts.follow_up_step IS 'Current step in the vertical follow-up cadence (0 = none sent)';
COMMENT ON COLUMN contacts.follow_up_last_sent IS 'Timestamp of the last automated follow-up message sent';
