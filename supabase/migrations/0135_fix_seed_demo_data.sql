-- Fix Default Pipeline: correct pipeline_type, is_default, and stage names
-- Prevents regression on fresh deploys from 0125_seed_demo_data.sql

UPDATE pipelines
SET pipeline_type = 'deals', is_default = true
WHERE id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884'
AND tenant_id = '018323e5-4866-486e-bc90-15cfeb910fc4';

UPDATE pipeline_stages SET name = 'New Lead'      WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 1;
UPDATE pipeline_stages SET name = 'Contacted'     WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 2;
UPDATE pipeline_stages SET name = 'Proposal Sent' WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 3;
UPDATE pipeline_stages SET name = 'Negotiation'   WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 4;
UPDATE pipeline_stages SET name = 'Follow-Up'     WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 5;
UPDATE pipeline_stages SET name = 'Closed Lost'   WHERE pipeline_id = '54942bdf-1ff3-495e-b8ca-bcd9ee3da884' AND position = 6;

-- Fix referral commission rate default
ALTER TABLE referral_codes ALTER COLUMN commission_rate SET DEFAULT 20.00;

-- Enable campaigns module on demo tenant
UPDATE tenants
SET modules = modules || '{"campaigns":true}'::jsonb
WHERE id = '018323e5-4866-486e-bc90-15cfeb910fc4';
