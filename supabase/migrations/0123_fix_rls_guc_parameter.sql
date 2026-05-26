-- Migration 0123: Fix RLS GUC parameter name mismatch.
--
-- ROOT CAUSE
-- ----------
-- The application sets GUC parameter `app.current_tenant_id` on every
-- authenticated request (see apps/api/src/routes/appointments.ts:198 and
-- the requireAuth middleware). However 56 RLS policies across 17 migrations
-- (0003, 0004, 0007, 0009, 0010, 0011, 0012, 0014, 0018, 0020, 0062, 0111,
-- 0113, 0114, 0115, 0118, 0119) reference the *different* GUC parameter
-- `app.tenant_id` via a bare current_setting() call that omits the
-- missing_ok parameter:
--
--   current_setting('app.tenant_id')::uuid   ← WRONG: throws error if not set
--
-- Because `app.tenant_id` is never set, every query against those tables
-- throws "unrecognized configuration parameter 'app.tenant_id'" at the RLS
-- evaluation stage. The API server uses the service-role key (BYPASSRLS), so
-- it never hits these errors, but the database-layer tenant isolation backstop
-- is completely non-functional for those 56 policies.
--
-- FIX
-- ---
-- 1. Harden current_tenant_id() to COALESCE both parameter names with
--    missing_ok=TRUE, preferring the name the app actually sets.
-- 2. Dynamically rebuild every broken policy to call current_tenant_id()
--    instead of the bare current_setting() — this is idempotent and handles
--    both the pre-14 and 14+ PostgreSQL decompiled forms.
-- 3. Fail loudly (raise exception) if any broken policy survives.

BEGIN;

-- ── 1. Harden current_tenant_id() ────────────────────────────────────────────
--
-- Reads app.current_tenant_id first (what the app always sets), then falls
-- back to app.tenant_id for any legacy paths.  Both use missing_ok=TRUE so
-- neither throws if the parameter has not been set yet (e.g. during
-- migration dry-runs or direct psql sessions).
--
-- SECURITY INVOKER: runs with the permissions of the calling user (correct
-- for an RLS helper; no privilege escalation).
-- SET search_path = '': prevents search-path-injection attacks.

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('app.current_tenant_id', TRUE),
      current_setting('app.tenant_id',         TRUE)
    ),
    ''
  )::UUID;
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '';

-- ── 2. Dynamic rebuild of all broken policies ─────────────────────────────────
--
-- Queries pg_policies for every policy whose USING or WITH CHECK clause
-- still references app.tenant_id directly, then drops and recreates it
-- using current_tenant_id() instead.
--
-- PostgreSQL decompiles the stored policy expression in two known forms
-- depending on server version:
--   Form A (PG < 14): current_setting('app.tenant_id')::uuid
--   Form B (PG ≥ 14): (current_setting('app.tenant_id'::text))::uuid
-- Both are replaced by the REPLACE chain below.
--
-- The loop preserves: policy name, table, schema, permissive/restrictive,
-- roles, command (SELECT/INSERT/UPDATE/DELETE/ALL), USING clause, and
-- WITH CHECK clause.

DO $$
DECLARE
  r           RECORD;
  new_qual    TEXT;
  new_check   TEXT;
  sql_stmt    TEXT;
  fix_count   INTEGER := 0;
  remaining   INTEGER;
BEGIN
  FOR r IN
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE qual       LIKE $q$%app.tenant_id%$q$
       OR with_check LIKE $q$%app.tenant_id%$q$
    ORDER BY schemaname, tablename, policyname
  LOOP
    -- Replace both decompiled forms of the broken pattern.
    -- Order matters: replace the longer Form B first so the shorter Form A
    -- pattern does not partially match and leave a dangling cast.
    new_qual := REPLACE(
                  REPLACE(
                    r.qual,
                    $s$(current_setting('app.tenant_id'::text))::uuid$s$,
                    'current_tenant_id()'
                  ),
                  $s$current_setting('app.tenant_id')::uuid$s$,
                  'current_tenant_id()'
                );

    new_check := CASE
      WHEN r.with_check IS NOT NULL THEN
        REPLACE(
          REPLACE(
            r.with_check,
            $s$(current_setting('app.tenant_id'::text))::uuid$s$,
            'current_tenant_id()'
          ),
          $s$current_setting('app.tenant_id')::uuid$s$,
          'current_tenant_id()'
        )
      ELSE NULL
    END;

    -- ── Safety guard ──────────────────────────────────────────────────────────
    -- If the REPLACE didn't eliminate the broken pattern it means the
    -- decompiled form is an unexpected variant.  Fail loudly rather than
    -- silently recreating a still-broken policy.
    IF new_qual  LIKE $q$%app.tenant_id%$q$
    OR (new_check IS NOT NULL AND new_check LIKE $q$%app.tenant_id%$q$)
    THEN
      RAISE EXCEPTION
        'Policy %.% on %.%: REPLACE did not eliminate app.tenant_id reference. '
        'Unexpected decompiled form — manual fix required. qual="%"',
        r.schemaname, r.policyname, r.schemaname, r.tablename,
        r.qual;
    END IF;

    -- ── Drop old policy ───────────────────────────────────────────────────────
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );

    -- ── Reconstruct CREATE POLICY ─────────────────────────────────────────────
    sql_stmt := format(
      'CREATE POLICY %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );

    -- AS PERMISSIVE | RESTRICTIVE
    IF r.permissive = 'PERMISSIVE' THEN
      sql_stmt := sql_stmt || ' AS PERMISSIVE';
    ELSE
      sql_stmt := sql_stmt || ' AS RESTRICTIVE';
    END IF;

    -- FOR <cmd>  (omit FOR clause when ALL — it is the default)
    IF r.cmd IS DISTINCT FROM 'ALL' THEN
      sql_stmt := sql_stmt || ' FOR ' || r.cmd;
    END IF;

    -- TO <roles>
    IF r.roles IS NOT NULL AND array_length(r.roles, 1) > 0 THEN
      sql_stmt := sql_stmt || ' TO ' || array_to_string(r.roles, ', ');
    END IF;

    -- USING ( <expr> )
    IF new_qual IS NOT NULL THEN
      sql_stmt := sql_stmt || ' USING (' || new_qual || ')';
    END IF;

    -- WITH CHECK ( <expr> )
    IF new_check IS NOT NULL THEN
      sql_stmt := sql_stmt || ' WITH CHECK (' || new_check || ')';
    END IF;

    EXECUTE sql_stmt;

    fix_count := fix_count + 1;
    RAISE NOTICE '[0123] Rebuilt policy % on %.%  (% of loop)',
      r.policyname, r.schemaname, r.tablename, fix_count;
  END LOOP;

  RAISE NOTICE '[0123] Rebuilt % policies total.', fix_count;

  -- ── 3. Hard verification — fail loudly if anything was missed ─────────────
  -- Re-query using a more specific pattern so we don't accidentally match
  -- the current_tenant_id() function body that COALESCES both names.
  -- pg_policies.qual contains the decompiled expression of the policy itself,
  -- not the body of functions it calls, so this is safe.
  SELECT COUNT(*) INTO remaining
  FROM pg_policies
  WHERE qual       LIKE $q$%current_setting%app.tenant_id%$q$
     OR with_check LIKE $q$%current_setting%app.tenant_id%$q$;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      '[0123] RLS fix INCOMPLETE: % broken policies still reference '
      'app.tenant_id directly via current_setting(). '
      'Run the POST-MIGRATION VERIFICATION query below for details.',
      remaining;
  END IF;

  RAISE NOTICE '[0123] ✓ RLS GUC parameter fix complete — 0 broken policies remain.';
END;
$$;

COMMIT;

-- ── POST-MIGRATION VERIFICATION ───────────────────────────────────────────────
-- Run this after applying the migration to confirm zero broken policies remain.
-- Expected result: 0 rows.
--
-- SELECT tablename, policyname, qual
-- FROM pg_policies
-- WHERE qual       LIKE '%current_setting%app.tenant_id%'
--    OR with_check LIKE '%current_setting%app.tenant_id%';
--
-- To confirm current_tenant_id() now resolves correctly for the current session:
--
-- SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-000000000001', TRUE);
-- SELECT current_tenant_id();
-- -- Expected: 00000000-0000-0000-0000-000000000001
