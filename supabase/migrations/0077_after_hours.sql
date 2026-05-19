ALTER TABLE locations ADD COLUMN IF NOT EXISTS after_hours_enabled boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS business_hours jsonb DEFAULT '{
  "mon": {"open": "09:00", "close": "17:00", "enabled": true},
  "tue": {"open": "09:00", "close": "17:00", "enabled": true},
  "wed": {"open": "09:00", "close": "17:00", "enabled": true},
  "thu": {"open": "09:00", "close": "17:00", "enabled": true},
  "fri": {"open": "09:00", "close": "17:00", "enabled": true},
  "sat": {"open": "09:00", "close": "13:00", "enabled": false},
  "sun": {"open": "09:00", "close": "13:00", "enabled": false}
}';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS after_hours_message text DEFAULT 'We are currently closed. Please leave your name and number and we will call you back during business hours.';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Chicago';
