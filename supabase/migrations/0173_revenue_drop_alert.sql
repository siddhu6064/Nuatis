-- Revenue-drop threshold alerting in Insights — every insights endpoint is
-- pull-based aggregation, nothing pushes an alert. Mirrors
-- inventory_items.last_low_stock_notified_at's cooldown-column shape
-- (0001_initial_schema.sql / low-stock-scanner.ts), one column at the
-- tenant level since this is a tenant-wide metric, not a per-row one.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS revenue_alert_last_sent_at timestamptz;
