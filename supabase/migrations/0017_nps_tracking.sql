-- 0017_nps_tracking.sql
-- NPS survey tracking on tenant.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_submitted_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_score integer;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_dismissed boolean DEFAULT false;
