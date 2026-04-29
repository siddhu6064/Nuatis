-- Migration 0057: Add phone_number_from and phone_number_to to calls table
-- Applied manually via Supabase SQL editor on 2026-04-29
ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone_number_from text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone_number_to text;
COMMENT ON COLUMN calls.phone_number_from IS 'Caller E.164 phone number';
COMMENT ON COLUMN calls.phone_number_to IS 'Called E.164 phone number';
