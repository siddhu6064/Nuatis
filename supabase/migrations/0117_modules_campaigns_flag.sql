-- 0117_modules_campaigns_flag.sql
-- P13 AI Campaigns: add 'campaigns' key to the modules JSONB column on tenants.
-- Defaults to false so existing tenants must opt in; new tenants inherit from defaults.

UPDATE tenants
  SET modules = COALESCE(modules, '{}'::jsonb) || '{"campaigns": false}'::jsonb
  WHERE NOT (COALESCE(modules, '{}'::jsonb) ? 'campaigns');
