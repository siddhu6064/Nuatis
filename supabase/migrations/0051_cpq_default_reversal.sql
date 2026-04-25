-- ============================================================
-- CPQ default reversal (April 2026)
-- Product decision: CPQ is an add-on across ALL 9 verticals.
-- Flips modules.cpq = false for every tenant except the three
-- protected tenants (internal + demo) which remain forced ON.
-- New tenant provisioning already defaults cpq: false in
-- apps/api/src/routes/tenants.ts — this migration enforces
-- the same rule retroactively in the DB.
-- ============================================================

BEGIN;

-- Log affected count before update
DO $$
DECLARE
  affected_count INT;
BEGIN
  SELECT COUNT(*) INTO affected_count
  FROM tenants
  WHERE id NOT IN (
    'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',  -- Nuatis Internal
    '0d9a00b9-ce40-4702-a99c-ed23f11fdb08',  -- Nuatis Demo (legacy)
    '018323e5-4866-486e-bc90-15cfeb910fc4'   -- Nuatis Demo (new, all-verticals)
  )
  AND (modules->>'cpq')::boolean = true;

  RAISE NOTICE 'CPQ default reversal: % tenant(s) will have CPQ flipped to false', affected_count;
END $$;

-- Flip CPQ to false for all non-protected tenants
UPDATE tenants
SET modules = jsonb_set(modules, '{cpq}', 'false'::jsonb)
WHERE id NOT IN (
  'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08',
  '018323e5-4866-486e-bc90-15cfeb910fc4'
)
AND (modules->>'cpq') IS DISTINCT FROM 'false';

-- Ensure all three protected tenants have cpq = true
UPDATE tenants
SET modules = jsonb_set(modules, '{cpq}', 'true'::jsonb)
WHERE id IN (
  'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08',
  '018323e5-4866-486e-bc90-15cfeb910fc4'
)
AND (modules->>'cpq') IS DISTINCT FROM 'true';

COMMIT;
