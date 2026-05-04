-- Migration 0058: Remove Clerk integration from schema
-- Phase 2 of Clerk removal. Phase 1 (runtime code) shipped in commit aae45899.
-- Backfills authjs_user_id from id where NULL (fixes stranded users including sid@nuatis.com),
-- then drops all Clerk-related columns, indexes, and CHECK constraints.

BEGIN;

-- Step 1: Backfill authjs_user_id for any user whose record was created under
-- the deprecated Clerk path. Setting it to id is safe because the OR-CHECK
-- ensured at least one of clerk_user_id / authjs_user_id was non-null.
UPDATE users
SET authjs_user_id = id
WHERE authjs_user_id IS NULL;

-- Step 2: Backfill tenant auth_provider — every tenant uses Auth.js now.
-- (Pre-flight confirmed all rows already have auth_provider = 'authjs'; this is a no-op.)
UPDATE tenants
SET auth_provider = 'authjs'
WHERE auth_provider IS DISTINCT FROM 'authjs';

-- Step 3: Drop the OR-CHECK constraint that allowed clerk_user_id as auth proof.
-- Named explicitly in migration 0002 as user_has_auth_id.
ALTER TABLE users DROP CONSTRAINT IF EXISTS user_has_auth_id;

-- Step 4: Make authjs_user_id NOT NULL now that every row is backfilled.
ALTER TABLE users ALTER COLUMN authjs_user_id SET NOT NULL;

-- Step 5: Drop the auth_provider CHECK constraint on tenants.
-- Auto-named by Postgres as tenants_auth_provider_check (inline column CHECK from migration 0002).
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_auth_provider_check;

-- Step 6: Drop the clerk-only index.
DROP INDEX IF EXISTS idx_tenants_clerk_org;

-- Step 7: Drop the Clerk columns.
ALTER TABLE users DROP COLUMN IF EXISTS clerk_user_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS clerk_org_id;

-- Step 8: Drop the now-redundant auth_provider column on tenants.
-- Single auth system means this column is always 'authjs' — no value in keeping it.
ALTER TABLE tenants DROP COLUMN IF EXISTS auth_provider;

COMMIT;
