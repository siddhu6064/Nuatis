ALTER TABLE appointments ADD COLUMN IF NOT EXISTS video_link text DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS video_provider text DEFAULT NULL;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS video_conferencing_enabled boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS video_provider text DEFAULT 'google_meet';
