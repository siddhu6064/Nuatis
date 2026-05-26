-- 0125_seed_demo_data.sql
-- Seeds demo tenant with ~14 deals and ~14 activity_log entries.
-- Safe to re-run: explicit UUIDs + ON CONFLICT (id) DO NOTHING.

DO $$
DECLARE
  v_tenant  UUID := '018323e5-4866-486e-bc90-15cfeb910fc4';
  v_pipeline UUID;
  s         UUID[];  -- pipeline_stage ids ordered by position
  c         UUID[];  -- first 14 contact ids ordered by created_at
BEGIN

  -- -----------------------------------------------------------------------
  -- Resolve pipeline: prefer is_default, fall back to any pipeline
  -- -----------------------------------------------------------------------
  SELECT id INTO v_pipeline
  FROM pipelines
  WHERE tenant_id = v_tenant
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  IF v_pipeline IS NULL THEN
    RAISE NOTICE '0125: no pipeline found for demo tenant — skipping.';
    RETURN;
  END IF;

  -- Stage IDs in position order (s[1] = earliest stage, s[N] = latest)
  SELECT ARRAY(
    SELECT id
    FROM   pipeline_stages
    WHERE  pipeline_id = v_pipeline
    ORDER  BY position ASC
  ) INTO s;

  -- First 14 contacts for the tenant
  SELECT ARRAY(
    SELECT id
    FROM   contacts
    WHERE  tenant_id = v_tenant
    ORDER  BY created_at ASC
    LIMIT  14
  ) INTO c;

  -- -----------------------------------------------------------------------
  -- DEALS  (~14 rows, spread across stages)
  -- -----------------------------------------------------------------------
  INSERT INTO deals
    (id, tenant_id, contact_id, title, value,
     pipeline_stage_id, close_date, probability, notes,
     created_at, updated_at)
  VALUES
    -- Stage 1  (Lead / top-of-funnel)
    ('a1000001-0000-0000-0000-000000000001', v_tenant, c[1],
     'Website Redesign Package',         4500.00,
     s[1], CURRENT_DATE + 14,  20, NULL,
     NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'),

    ('a1000001-0000-0000-0000-000000000006', v_tenant, c[6],
     'Email Campaign — Spring 2026',     1950.00,
     s[1], CURRENT_DATE + 10,  25, NULL,
     NOW() - INTERVAL '1 day',   NOW() - INTERVAL '1 day'),

    ('a1000001-0000-0000-0000-00000000000b', v_tenant, c[11],
     'Logo + Style Guide',                950.00,
     s[1], CURRENT_DATE +  7,  15, NULL,
     NOW() - INTERVAL '10 hours', NOW() - INTERVAL '10 hours'),

    -- Stage 2  (Qualified / contacted)
    ('a1000001-0000-0000-0000-000000000002', v_tenant, c[2],
     'Annual SEO Retainer',             12000.00,
     s[2], CURRENT_DATE + 30,  45, NULL,
     NOW() - INTERVAL '3 days',  NOW() - INTERVAL '3 days'),

    ('a1000001-0000-0000-0000-000000000003', v_tenant, c[3],
     'Social Media Management Q3',       3200.00,
     s[2], CURRENT_DATE + 21,  50, NULL,
     NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'),

    ('a1000001-0000-0000-0000-000000000007', v_tenant, c[7],
     'PPC Google Ads Setup',             2750.00,
     s[2], CURRENT_DATE + 20,  40, NULL,
     NOW() - INTERVAL '1 day',   NOW() - INTERVAL '1 day'),

    ('a1000001-0000-0000-0000-00000000000a', v_tenant, c[10],
     'Video Production — 3 Reels',       4200.00,
     s[2], CURRENT_DATE + 25,  45, NULL,
     NOW() - INTERVAL '12 hours', NOW() - INTERVAL '12 hours'),

    ('a1000001-0000-0000-0000-00000000000d', v_tenant, c[13],
     'Copywriting + Blog Package',       2100.00,
     s[2], CURRENT_DATE + 15,  35, NULL,
     NOW() - INTERVAL '5 hours',  NOW() - INTERVAL '5 hours'),

    -- Stage 3  (Proposal sent)
    ('a1000001-0000-0000-0000-000000000004', v_tenant, c[4],
     'E-Commerce Store Build',          15000.00,
     s[3], CURRENT_DATE + 45,  60, 'Shopify + custom integrations',
     NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'),

    ('a1000001-0000-0000-0000-000000000005', v_tenant, c[5],
     'Brand Identity Overhaul',          6800.00,
     s[3], CURRENT_DATE + 28,  65, NULL,
     NOW() - INTERVAL '2 days',  NOW() - INTERVAL '2 days'),

    ('a1000001-0000-0000-0000-000000000009', v_tenant, c[9],
     'Photography + Content Bundle',     3800.00,
     s[3], CURRENT_DATE + 18,  55, NULL,
     NOW() - INTERVAL '18 hours', NOW() - INTERVAL '18 hours'),

    ('a1000001-0000-0000-0000-00000000000e', v_tenant, c[14],
     'Marketing Analytics Dashboard',    9800.00,
     s[3], CURRENT_DATE + 50,  70, 'Looker Studio + BigQuery',
     NOW() - INTERVAL '2 hours',  NOW() - INTERVAL '2 hours'),

    -- Stage 4  (Negotiation / closing)
    ('a1000001-0000-0000-0000-000000000008', v_tenant, c[8],
     'CRM Data Migration',               5500.00,
     s[4], CURRENT_DATE + 35,  75, NULL,
     NOW() - INTERVAL '1 day',   NOW() - INTERVAL '1 day'),

    ('a1000001-0000-0000-0000-00000000000c', v_tenant, c[12],
     'IT Infrastructure Audit',          7500.00,
     s[4], CURRENT_DATE + 40,  80, 'Includes cloud migration estimate',
     NOW() - INTERVAL '8 hours',  NOW() - INTERVAL '8 hours')

  ON CONFLICT (id) DO NOTHING;

  -- -----------------------------------------------------------------------
  -- ACTIVITY LOG  (~14 rows, mix of types over past 3 days)
  -- -----------------------------------------------------------------------
  INSERT INTO activity_log
    (id, tenant_id, contact_id, type, body, metadata, actor_type, created_at)
  VALUES
    ('b2000002-0000-0000-0000-000000000001', v_tenant, c[1],
     'call',
     'Intro call — discussed redesign scope and timeline.',
     '{}', 'user', NOW() - INTERVAL '3 days'),

    ('b2000002-0000-0000-0000-000000000002', v_tenant, c[2],
     'note',
     'Prospect confirmed budget approved for SEO retainer through Q4.',
     '{}', 'user', NOW() - INTERVAL '3 days'),

    ('b2000002-0000-0000-0000-000000000003', v_tenant, c[3],
     'email',
     'Sent proposal PDF for social media management package.',
     '{}', 'user', NOW() - INTERVAL '2 days 20 hours'),

    ('b2000002-0000-0000-0000-000000000004', v_tenant, c[4],
     'deal_created',
     'Deal created: E-Commerce Store Build ($15,000).',
     '{}', 'user', NOW() - INTERVAL '2 days 18 hours'),

    ('b2000002-0000-0000-0000-000000000005', v_tenant, c[5],
     'appointment',
     'Discovery meeting scheduled — brand audit and competitor review.',
     '{}', 'user', NOW() - INTERVAL '2 days 10 hours'),

    ('b2000002-0000-0000-0000-000000000006', v_tenant, c[6],
     'sms',
     'Sent follow-up: "Hi! Wanted to share our spring email promo deck."',
     '{}', 'ai',   NOW() - INTERVAL '1 day 22 hours'),

    ('b2000002-0000-0000-0000-000000000007', v_tenant, c[7],
     'call',
     'Left voicemail about PPC audit results. Will follow up by email.',
     '{}', 'user', NOW() - INTERVAL '1 day 18 hours'),

    ('b2000002-0000-0000-0000-000000000008', v_tenant, c[8],
     'note',
     'Client confirmed go-ahead on CRM migration. Kickoff set for next Monday.',
     '{}', 'user', NOW() - INTERVAL '1 day 12 hours'),

    ('b2000002-0000-0000-0000-000000000009', v_tenant, c[9],
     'email',
     'Photography bundle quote sent — two options (basic vs. premium).',
     '{}', 'user', NOW() - INTERVAL '20 hours'),

    ('b2000002-0000-0000-0000-00000000000a', v_tenant, c[10],
     'appointment',
     'Video shoot scheduled for June 3rd at client HQ.',
     '{}', 'user', NOW() - INTERVAL '16 hours'),

    ('b2000002-0000-0000-0000-00000000000b', v_tenant, c[11],
     'deal_created',
     'Deal created: Logo + Style Guide ($950).',
     '{}', 'user', NOW() - INTERVAL '10 hours'),

    ('b2000002-0000-0000-0000-00000000000c', v_tenant, c[12],
     'call',
     'Technical walkthrough call — reviewed current infra and pain points.',
     '{}', 'user', NOW() - INTERVAL '7 hours'),

    ('b2000002-0000-0000-0000-00000000000d', v_tenant, c[13],
     'sms',
     'Blog package confirmed via text. Starting content calendar next week.',
     '{}', 'ai',   NOW() - INTERVAL '4 hours'),

    ('b2000002-0000-0000-0000-00000000000e', v_tenant, c[14],
     'note',
     'Client requested Looker Studio mockup before signing. Deadline: May 30.',
     '{}', 'user', NOW() - INTERVAL '1 hour')

  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE '0125: demo seed complete (deals + activity_log).';

END $$;
