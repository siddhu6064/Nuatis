-- 0016_location_details.sql
-- Locations table already has name, address, city, state, zip from 0001.
-- Add a display phone column if not present.

ALTER TABLE locations ADD COLUMN IF NOT EXISTS phone text;
