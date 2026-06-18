-- Migration 0133: Remove dead `copilot` key from all tenant modules JSONB
-- copilot is not in VALID_MODULES, stripe-plans.ts, or any route guard.
-- Stripping it from all tenants — internal and demo included (no functional impact).

BEGIN;

UPDATE tenants
SET modules = modules - 'copilot'
WHERE modules ? 'copilot';

-- Verify: should return 0 rows after update
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT COUNT(*) INTO remaining FROM tenants WHERE modules ? 'copilot';
  IF remaining > 0 THEN
    RAISE EXCEPTION '0133: % tenant(s) still have copilot key after update', remaining;
  END IF;
END $$;

COMMIT;
