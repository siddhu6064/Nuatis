-- ============================================================
--  0140 — Orders: error flag, delivery tracking, metadata
--  Adapted from openshiporg/openship's Order.error /
--  TrackingDetail / orderMetadata patterns.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_carrier text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
