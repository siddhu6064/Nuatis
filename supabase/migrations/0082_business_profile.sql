-- G1: add structured business profile to locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS business_profile JSONB DEFAULT '{}'::jsonb;
