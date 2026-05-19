ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_reserve_enabled boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_reserve_merchant_id text DEFAULT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_place_id text DEFAULT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS google_reserve_status text DEFAULT 'not_submitted';
