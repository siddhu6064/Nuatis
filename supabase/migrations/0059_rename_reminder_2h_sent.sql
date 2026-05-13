-- Migration 0059: rename reminder_2h_sent → reminder_1h_sent
-- Wrapped in existence check — column was applied directly to Supabase in May 2026
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'appointments'
    AND column_name = 'reminder_2h_sent'
  ) THEN
    ALTER TABLE appointments RENAME COLUMN reminder_2h_sent TO reminder_1h_sent;
  END IF;
END $$;
