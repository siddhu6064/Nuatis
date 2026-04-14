-- 0015_call_recording.sql
-- Add recording URL and duration to voice sessions.

ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS recording_url text;
ALTER TABLE voice_sessions ADD COLUMN IF NOT EXISTS recording_duration_seconds integer;
