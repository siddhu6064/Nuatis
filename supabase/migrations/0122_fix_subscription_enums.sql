-- 0122_fix_subscription_enums.sql
-- Phase 9 follow-up — extend the subscription_plan + subscription_status
-- ENUM types so the new tier names (core/scale) and the 'incomplete'
-- lifecycle state are valid values.
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block in Postgres, so this migration is NOT wrapped in BEGIN/COMMIT.
-- Supabase runs each migration file in its own implicit batch.
--
-- Note: the codebase standardises on the existing enum values from
-- 0001_initial_schema.sql — 'canceled' (1 L) and 'unpaid' — instead of
-- introducing UK / Stripe-style alternates. No 'cancelled' / 'paused'
-- additions here; those are already covered by the existing enum.

-- ── Add new plan values ──────────────────────────────────────────────────────
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'core';
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'scale';

-- ── Add missing status value ─────────────────────────────────────────────────
ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'incomplete';

-- ── Backfill: rename legacy tiers ────────────────────────────────────────────
UPDATE tenants SET subscription_plan = 'core'
  WHERE subscription_plan = 'starter';

UPDATE tenants SET subscription_plan = 'scale'
  WHERE subscription_plan = 'growth';

-- ── Set Maya minute limits per current plan ──────────────────────────────────
UPDATE tenants SET maya_minutes_limit = 300, maya_overage_rate = 0.05
  WHERE subscription_plan = 'core';

UPDATE tenants SET maya_minutes_limit = 600, maya_overage_rate = 0.04
  WHERE subscription_plan = 'pro';

UPDATE tenants SET maya_minutes_limit = NULL, maya_overage_rate = NULL
  WHERE subscription_plan = 'scale';
