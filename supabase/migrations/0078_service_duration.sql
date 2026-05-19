-- duration_minutes already exists on services (0012_cpq_tables.sql); add IF NOT EXISTS is a no-op but safe
ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT 30;
-- Link appointments to the service that was booked
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES services(id) ON DELETE SET NULL;
