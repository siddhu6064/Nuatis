-- Allow blocked calendar slots to have no associated contact.
-- 0075_blocked_slots.sql added is_blocked/block_reason but never relaxed
-- appointments.contact_id's NOT NULL constraint from 0001_initial_schema.sql,
-- so POST /api/appointments/block has 500'd on every submission since the
-- feature shipped. Frontend code already types contacts as nullable
-- (`{ full_name: string } | null`) and already guards on falsy contact_id
-- (see review-automation check in apps/api/src/routes/appointments.ts), so
-- this is just catching the schema up to what the rest of the app assumes.
ALTER TABLE appointments ALTER COLUMN contact_id DROP NOT NULL;
