-- Migration 0134: Canonicalize scheduling key on demo tenant (additive)
-- Internal tenant c35f4ce4 already uses scheduling:true (correct).
-- Demo tenant 018323e5 uses the legacy appointments:true key. Add the canonical
-- scheduling:true alongside it. The legacy `appointments` key is intentionally
-- KEPT — the appointments route guard + web redirect still read it. Removing it
-- is deferred to a later cleanup migration.
-- No other tenants exist in production.

BEGIN;

UPDATE tenants
SET modules = modules || '{"scheduling": true}'::jsonb
WHERE id = '018323e5-4866-486e-bc90-15cfeb910fc4'
  AND NOT (modules ? 'scheduling');

-- Safety: verify both tenants now have scheduling:true
DO $$
DECLARE
  missing INT;
BEGIN
  SELECT COUNT(*) INTO missing
  FROM tenants
  WHERE id IN (
    'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
    '018323e5-4866-486e-bc90-15cfeb910fc4'
  )
  AND (modules->>'scheduling')::boolean IS NOT TRUE;

  IF missing > 0 THEN
    RAISE EXCEPTION '0134: % tenant(s) missing scheduling:true after migration', missing;
  END IF;
END $$;

COMMIT;
