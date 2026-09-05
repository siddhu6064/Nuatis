-- Cooldown columns so the new stale-pending-approval scanner can re-notify
-- at most once per cooldown window, mirroring inventory_items'
-- last_low_stock_notified_at pattern (0104_inventory_low_stock.sql equivalent).
ALTER TABLE time_off_requests ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;
