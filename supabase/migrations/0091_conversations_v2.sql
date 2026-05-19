-- G3b: staff assignment + message read tracking
ALTER TABLE conversation_status
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
