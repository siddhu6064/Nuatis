-- 0005_maya_settings.sql
-- Add Maya voice AI configuration columns to locations table.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS maya_enabled boolean DEFAULT true;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS escalation_phone text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS maya_greeting text;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS maya_personality text DEFAULT 'professional';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS preferred_languages text[] DEFAULT '{en}';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS appointment_duration_default integer DEFAULT 60;

COMMENT ON COLUMN locations.maya_enabled IS 'When false, Maya does not answer calls — falls through to voicemail/forwarding';
COMMENT ON COLUMN locations.escalation_phone IS 'E.164 phone number for human escalation. Overrides ESCALATION_PHONE_DEFAULT env var';
COMMENT ON COLUMN locations.maya_greeting IS 'Custom greeting override. NULL uses default from vertical system prompt';
COMMENT ON COLUMN locations.maya_personality IS 'Tone: professional, friendly, casual. Affects system prompt generation';
COMMENT ON COLUMN locations.preferred_languages IS 'Language codes Maya should respond in: en, es, hi, te';
COMMENT ON COLUMN locations.appointment_duration_default IS 'Default appointment slot length in minutes';
