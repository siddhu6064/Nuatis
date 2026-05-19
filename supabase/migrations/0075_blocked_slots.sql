ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_blocked boolean DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS block_reason text DEFAULT NULL;
