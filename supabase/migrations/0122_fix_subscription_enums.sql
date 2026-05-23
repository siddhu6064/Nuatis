-- 0122_fix_subscription_enums.sql
-- Phase 9 follow-up — extend the subscription_status + subscription_plan
-- ENUM types so the new tier names (core/pro/scale) and lifecycle states
-- (cancelled, paused, incomplete) are valid values.
--
-- ALTER TYPE ... ADD VALUE must be committed before the new values can be
-- used in subsequent statements, so the enum additions live inside their
-- own transaction and the data backfills run outside it.

BEGIN;

-- Add missing subscription_status enum values.
-- Note: 0001 already defines 'paused'; IF NOT EXISTS makes this safe.
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'incomplete';

-- Add the new Phase 9 plan tier names. 'pro' is already present from 0001.
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'core';
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'scale';

COMMIT;

-- ── Backfill: rename legacy tiers + set minute limits for current plans ──────
-- These run after the COMMIT above so the new enum values are visible.

UPDATE tenants SET subscription_plan = 'core'
  WHERE subscription_plan = 'starter';

UPDATE tenants SET subscription_plan = 'scale'
  WHERE subscription_plan = 'growth';

UPDATE tenants SET
  maya_minutes_limit = 300,
  maya_overage_rate = 0.05
WHERE subscription_plan = 'core';

UPDATE tenants SET
  maya_minutes_limit = 600,
  maya_overage_rate = 0.04
WHERE subscription_plan = 'pro';

UPDATE tenants SET
  maya_minutes_limit = NULL,
  maya_overage_rate = NULL
WHERE subscription_plan = 'scale';
