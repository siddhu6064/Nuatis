-- 0129_tenant_fk_cascade.sql
-- Normalize all tenant-scoped FKs to ON DELETE CASCADE so a tenant can be
-- deleted cleanly (churn / GDPR erasure). These 22 were NO ACTION and blocked
-- tenant deletion. All reference tenants(id) on column tenant_id.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'analytics_events','audit_log','chat_messages','chat_sessions',
    'email_messages','email_templates','export_jobs','intake_forms',
    'intake_submissions','lead_scoring_rules','mobile_push_tokens','pipelines',
    'push_subscriptions','quote_views','quotes','reports','review_requests',
    'services','tenant_users','user_email_accounts','voice_sessions',
    'webhook_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_tenant_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
      t, t || '_tenant_id_fkey'
    );
  END LOOP;
END $$;