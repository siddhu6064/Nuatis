-- Migration 0118: RLS coverage for 35 tables flagged by pre-deploy audit.
--
-- Adds ENABLE ROW LEVEL SECURITY + tenant_isolation policies to tables that
-- store tenant data but had no RLS. Service-role JWT bypasses RLS by default
-- (Supabase BYPASSRLS attribute), so the existing API is unaffected. This is
-- defense-in-depth for any code path that ever uses the anon key or a
-- tenant-scoped JWT.
--
-- Also unifies the two GUC key variants in use across migrations:
--   - app.tenant_id           (newer pattern, used by 0004/0010/0014/0111/etc.)
--   - app.current_tenant_id   (older pattern, read by current_tenant_id() fn)
-- by updating current_tenant_id() to prefer app.tenant_id and fall back to
-- app.current_tenant_id, so policies on either side share a single source.

BEGIN;

-- ── Function unification ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID,
    NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
  );
$$ LANGUAGE sql STABLE;

-- ── 34 tables with direct tenant_id column ───────────────────────────────────

ALTER TABLE availability_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON availability_schedules;
CREATE POLICY tenant_isolation ON availability_schedules
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE bookable_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bookable_resources;
CREATE POLICY tenant_isolation ON bookable_resources
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE calendar_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calendar_groups;
CREATE POLICY tenant_isolation ON calendar_groups
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON campaign_recipients;
CREATE POLICY tenant_isolation ON campaign_recipients
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE client_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON client_subscriptions;
CREATE POLICY tenant_isolation ON client_subscriptions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE conversation_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conversation_status;
CREATE POLICY tenant_isolation ON conversation_status
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE custom_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON custom_automations;
CREATE POLICY tenant_isolation ON custom_automations
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_events;
CREATE POLICY tenant_isolation ON email_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE gbp_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gbp_connections;
CREATE POLICY tenant_isolation ON gbp_connections
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gift_cards;
CREATE POLICY tenant_isolation ON gift_cards
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoice_line_items;
CREATE POLICY tenant_isolation ON invoice_line_items
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invoices;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE maya_kb_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maya_kb_files;
CREATE POLICY tenant_isolation ON maya_kb_files
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE maya_kb_urls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maya_kb_urls;
CREATE POLICY tenant_isolation ON maya_kb_urls
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON media_files;
CREATE POLICY tenant_isolation ON media_files
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE outbound_call_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outbound_call_jobs;
CREATE POLICY tenant_isolation ON outbound_call_jobs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_links;
CREATE POLICY tenant_isolation ON payment_links
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE portal_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal_access;
CREATE POLICY tenant_isolation ON portal_access
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE quote_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quote_payments;
CREATE POLICY tenant_isolation ON quote_payments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON referral_codes;
CREATE POLICY tenant_isolation ON referral_codes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE resource_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON resource_bookings;
CREATE POLICY tenant_isolation ON resource_bookings
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reviews;
CREATE POLICY tenant_isolation ON reviews
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE scanner_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scanner_pauses;
CREATE POLICY tenant_isolation ON scanner_pauses
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheduled_reports;
CREATE POLICY tenant_isolation ON scheduled_reports
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE smart_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON smart_lists;
CREATE POLICY tenant_isolation ON smart_lists
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE sms_delivery_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sms_delivery_errors;
CREATE POLICY tenant_isolation ON sms_delivery_errors
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sms_messages;
CREATE POLICY tenant_isolation ON sms_messages
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE snippets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON snippets;
CREATE POLICY tenant_isolation ON snippets
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE square_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON square_connections;
CREATE POLICY tenant_isolation ON square_connections
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE telnyx_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telnyx_numbers;
CREATE POLICY tenant_isolation ON telnyx_numbers
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE trigger_link_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON trigger_link_events;
CREATE POLICY tenant_isolation ON trigger_link_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE trigger_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON trigger_links;
CREATE POLICY tenant_isolation ON trigger_links
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE video_collectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON video_collectors;
CREATE POLICY tenant_isolation ON video_collectors
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE video_testimonials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON video_testimonials;
CREATE POLICY tenant_isolation ON video_testimonials
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE webchat_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webchat_sessions;
CREATE POLICY tenant_isolation ON webchat_sessions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ── webchat_messages: no direct tenant_id, isolation via join ────────────────
ALTER TABLE webchat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webchat_messages;
CREATE POLICY tenant_isolation ON webchat_messages
  USING (EXISTS (
    SELECT 1 FROM webchat_sessions s
    WHERE s.id = webchat_messages.session_id
      AND s.tenant_id = current_setting('app.tenant_id')::uuid
  ));

COMMIT;
