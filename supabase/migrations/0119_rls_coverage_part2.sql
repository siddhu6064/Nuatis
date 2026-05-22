-- Migration 0119: RLS coverage part 2 — 4 tables 0118 missed.
--
-- Three junction tables (calendar_group_members, deal_contacts,
-- quote_line_items) have no direct tenant_id column. They join to a parent
-- table that does, so the policy uses an EXISTS subquery against the parent.
-- referral_signups has referring_tenant_id and uses a direct policy.
--
-- Service-role JWT bypasses RLS by default; this is defense-in-depth.

BEGIN;

-- calendar_group_members: PK (group_id, location_id), no tenant_id. Parent calendar_groups.tenant_id.
ALTER TABLE calendar_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON calendar_group_members;
CREATE POLICY tenant_isolation ON calendar_group_members
  USING (EXISTS (
    SELECT 1 FROM calendar_groups cg
    WHERE cg.id = calendar_group_members.group_id
      AND cg.tenant_id = current_setting('app.tenant_id')::uuid
  ));

-- deal_contacts: (deal_id, contact_id) junction. Parent deals.tenant_id.
ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deal_contacts;
CREATE POLICY tenant_isolation ON deal_contacts
  USING (EXISTS (
    SELECT 1 FROM deals d
    WHERE d.id = deal_contacts.deal_id
      AND d.tenant_id = current_setting('app.tenant_id')::uuid
  ));

-- quote_line_items: child of quotes. Holds amounts/descriptions — sensitive.
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON quote_line_items;
CREATE POLICY tenant_isolation ON quote_line_items
  USING (EXISTS (
    SELECT 1 FROM quotes q
    WHERE q.id = quote_line_items.quote_id
      AND q.tenant_id = current_setting('app.tenant_id')::uuid
  ));

-- referral_signups: has referring_tenant_id — direct policy.
-- (referred_tenant_id is the signed-up tenant and is NULL until activation;
-- isolation scopes to the referrer's tenant view.)
ALTER TABLE referral_signups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON referral_signups;
CREATE POLICY tenant_isolation ON referral_signups
  USING (referring_tenant_id = current_setting('app.tenant_id')::uuid);

COMMIT;
