# Migrations to Apply — Production Supabase

**Audit date:** 2026-04-16
**Confirmed applied:** 0001_initial_schema, 0002_auth_vertical_configs
**Pending:** 0003 through 0042 (40 migrations)

`schema_versions` table is unreliable — only contains `1.0.0`, but 0002 is partially applied. Existence-based audit (querying for tables/columns introduced by each migration) is the source of truth.

## How to apply

For each pending migration, in order:

1. Open `supabase/migrations/XXXX_name.sql` in this repo.
2. Copy the entire file contents.
3. Go to Supabase Dashboard → SQL Editor → **New query**.
4. Paste, click **Run**.
5. If the migration fails (e.g., dependent type already exists), inspect the error and either:
   - Wrap in `IF NOT EXISTS` for idempotent re-runs, or
   - Comment out the failing block, run rest, then handle the failing piece manually.
6. Move to next file.

After each one, re-run the audit script (see end of file) to confirm it landed.

**IMPORTANT — apply strictly in order.** Many migrations reference tables/types created by earlier ones (e.g., 0028 deals depends on 0012 services).

## Migration list (in apply order)

### Phase 2-3 (foundational features)

| #    | File                             | Adds                                              |
| ---- | -------------------------------- | ------------------------------------------------- |
| 0003 | `0003_knowledge_base.sql`        | knowledge_base table                              |
| 0004 | `0004_voice_sessions.sql`        | voice_sessions table                              |
| 0005 | `0005_maya_settings.sql`         | maya\_\* cols on locations                        |
| 0006 | `0006_follow_up_tracking.sql`    | follow_up_step / follow_up_last_sent on contacts  |
| 0007 | `0007_webhook_subscriptions.sql` | webhook_subscriptions table                       |
| 0008 | `0008_onboarding_tracking.sql`   | onboarding_completed / onboarding_step on tenants |
| 0009 | `0009_push_subscriptions.sql`    | push_subscriptions table                          |
| 0010 | `0010_audit_log.sql`             | audit_log table                                   |
| 0011 | `0011_rbac.sql`                  | tenant_users table + RBAC roles                   |

### Phase 4 (CPQ)

| #    | File                             | Adds                                                 |
| ---- | -------------------------------- | ---------------------------------------------------- |
| 0012 | `0012_cpq_tables.sql`            | services, quotes, quote_line_items                   |
| 0013 | `0013_tenant_product_mode.sql`   | tenants.product col                                  |
| 0014 | `0014_analytics_events.sql`      | analytics_events table                               |
| 0015 | `0015_call_recording.sql`        | recording_url cols on voice_sessions                 |
| 0016 | `0016_location_details.sql`      | locations.phone col                                  |
| 0017 | `0017_nps_tracking.sql`          | nps\_\* cols on tenants                              |
| 0018 | `0018_quote_views.sql`           | quote_views table + quotes.followup_job_id           |
| 0019 | `0019_cpq_settings.sql`          | cpq_settings + discount/approval cols on quotes      |
| 0020 | `0020_service_packages.sql`      | service_packages table + quote_line_items.package_id |
| 0021 | `0021_quote_deposit_display.sql` | deposit_pct/amount/remaining cols on quotes          |
| 0022 | `0022_tenant_modules.sql`        | tenants.modules JSONB col                            |

### Phase 5-6 (CRM core)

| #    | File                       | Adds                                          |
| ---- | -------------------------- | --------------------------------------------- |
| 0023 | `0023_activity_log.sql`    | activity_log + tasks tables                   |
| 0024 | `0024_saved_views.sql`     | saved_views table                             |
| 0025 | `0025_import_jobs.sql`     | import_jobs table                             |
| 0026 | `0026_referral_fields.sql` | referral\_\* + timezone cols on contacts      |
| 0027 | `0027_attachments_sms.sql` | contact_attachments + inbound_sms tables      |
| 0028 | `0028_deals_companies.sql` | companies + deals tables, contacts.company_id |

### Phase 10 (email + booking + intake + scoring + reviews + pipelines + chat + outlook + reports + mobile)

| #    | File                                    | Adds                                                                   |
| ---- | --------------------------------------- | ---------------------------------------------------------------------- |
| 0029 | `0029_user_email_accounts.sql`          | user_email_accounts table                                              |
| 0030 | `0030_email_messages.sql`               | email_messages table                                                   |
| 0031 | `0031_email_templates.sql`              | email_templates table                                                  |
| 0032 | `0032_bcc_logging_address.sql`          | tenants.bcc_logging_address col                                        |
| 0033 | `0033_booking_page_settings.sql`        | booking\_\* cols on tenants                                            |
| 0034 | `0034_intake_forms.sql`                 | intake_forms table                                                     |
| 0035 | `0035_intake_submissions.sql`           | intake_submissions table                                               |
| 0036 | `0036_lifecycle_and_scoring.sql`        | lifecycle_stage/lead_score cols + lead_scoring_rules table             |
| 0037 | `0037_review_notifs_assignment.sql`     | review\_\* cols + assigned_to_user_id + review_requests table          |
| 0038 | `0038_multiple_pipelines.sql`           | pipelines table + pipeline_stages.pipeline_id                          |
| 0039 | `0039_chat_and_export.sql`              | chat*sessions, chat_messages, export_jobs tables + chat_widget*\* cols |
| 0040 | `0040_outlook_compliance_territory.sql` | outlook*calendar*\* + territory + compliance_fields                    |
| 0041 | `0041_reports.sql`                      | reports table                                                          |
| 0042 | `0042_mobile_push_tokens.sql`           | mobile_push_tokens table                                               |

## Re-audit after each batch

Run from `apps/api/`:

```bash
node --env-file=.env -e "
const {createClient} = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const checks = [
  ['0003','knowledge_base',null],['0004','voice_sessions',null],
  ['0005','locations','maya_enabled'],['0006','contacts','follow_up_step'],
  ['0007','webhook_subscriptions',null],['0008','tenants','onboarding_completed'],
  ['0009','push_subscriptions',null],['0010','audit_log',null],
  ['0011','tenant_users',null],['0012','services',null],
  ['0013','tenants','product'],['0014','analytics_events',null],
  ['0015','voice_sessions','recording_url'],['0016','locations','phone'],
  ['0017','tenants','nps_score'],['0018','quote_views',null],
  ['0019','tenants','cpq_settings'],['0020','service_packages',null],
  ['0021','quotes','deposit_pct'],['0022','tenants','modules'],
  ['0023','activity_log',null],['0024','saved_views',null],
  ['0025','import_jobs',null],['0026','contacts','referred_by_contact_id'],
  ['0027','contact_attachments',null],['0028','deals',null],
  ['0029','user_email_accounts',null],['0030','email_messages',null],
  ['0031','email_templates',null],['0032','tenants','bcc_logging_address'],
  ['0033','tenants','booking_page_enabled'],['0034','intake_forms',null],
  ['0035','intake_submissions',null],['0036','lead_scoring_rules',null],
  ['0037','review_requests',null],['0038','pipelines',null],
  ['0039','chat_sessions',null],['0040','tenants','calendar_provider'],
  ['0041','reports',null],['0042','mobile_push_tokens',null]
];
(async () => {
  for (const [m, t, c] of checks) {
    const { error } = await s.from(t).select(c || '*').limit(1);
    console.log((error ? '❌ pending' : '✅ applied') + ' — ' + m);
  }
})();
"
```

## Critical caveats

1. **0001 already created `pipeline_stages`** — when 0038 runs `ALTER TABLE pipeline_stages ADD pipeline_id`, ensure no conflict.
2. **0002 trailing `INSERT INTO schema_versions VALUES ('1.0.1', ...)`** never recorded. After applying everything, optionally do:
   ```sql
   INSERT INTO schema_versions (version, description) VALUES
     ('1.0.42', 'All migrations through 0042 applied — backfilled audit on 2026-04-16');
   ```
3. **Several migrations create `lifecycle_stage` ENUM** (0036). If type already exists, `CREATE TYPE` will error — wrap or skip.

## After all 40 are applied

Run the seed scripts (see `NUATIS_PENDING_TASKS.md` Task 4 section).
