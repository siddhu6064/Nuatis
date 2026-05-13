-- Migration 0061: Index on appointments.reminder_1h_sent for cron scanner performance
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_1h_sent
  ON appointments (reminder_1h_sent)
  WHERE reminder_1h_sent = false;
