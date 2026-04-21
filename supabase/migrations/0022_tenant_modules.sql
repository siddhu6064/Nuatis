-- Module gating: controls which feature sections are visible per tenant.
-- Separate from vertical (data config) — modules control feature visibility.
--
-- Module reference:
--   maya         — Voice AI tab, Call Log, Voice Settings
--   crm          — Contacts page
--   appointments — Appointments page
--   pipeline     — Pipeline Kanban
--   automation   — Automation, Follow-ups
--   cpq          — Quotes, Quote Settings, Packages
--   insights     — Insights dashboard
--
-- Default CPQ by vertical:
--   contractor, law_firm, real_estate, sales_crm → cpq: true
--   dental, salon, restaurant                   → cpq: false

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '{
  "maya": true,
  "crm": true,
  "appointments": true,
  "pipeline": true,
  "automation": true,
  "cpq": false,
  "insights": true
}'::jsonb;

-- Enable CPQ for verticals where quoting is core
UPDATE tenants
SET modules = modules || '{"cpq": true}'::jsonb
-- Cast to text to avoid enum-coercion error if 'sales_crm' is not yet in the
-- vertical_type enum on this DB; the new value is added in a later migration.
WHERE vertical::text IN ('contractor', 'law_firm', 'real_estate', 'sales_crm');

-- Force all modules ON for internal + demo tenants
UPDATE tenants
SET modules = '{
  "maya": true,
  "crm": true,
  "appointments": true,
  "pipeline": true,
  "automation": true,
  "cpq": true,
  "insights": true
}'::jsonb
WHERE id IN (
  'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b',
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08'
);
