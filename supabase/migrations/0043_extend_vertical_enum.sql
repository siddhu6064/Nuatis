-- Extend vertical_type enum with values referenced by the expanded verticals
-- registry (packages/shared/src/verticals/index.ts) and by modules.cpq
-- defaults in migration 0022. ALTER TYPE ADD VALUE is idempotent via
-- IF NOT EXISTS so re-running is safe on databases already bootstrapped
-- with these values via the dashboard.

ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'sales_crm';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'medical';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'veterinary';
