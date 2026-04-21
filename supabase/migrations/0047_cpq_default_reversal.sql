BEGIN;

-- CPQ is an add-on for all verticals — default OFF
-- Internal + demo tenants remain forced all-ON
UPDATE tenants
SET modules = jsonb_set(modules, '{cpq}', 'false'::jsonb)
WHERE id NOT IN (
  'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08'
);

SELECT COUNT(*) as tenants_updated
FROM tenants
WHERE id NOT IN (
  'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08'
);

COMMIT;
