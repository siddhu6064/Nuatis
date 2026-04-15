-- ============================================================
--  0026 — Referral fields + enrichment columns on contacts
--  Phase 8 Wk 61-62: bulk actions, referral tracking
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referred_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referral_source_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_referred_by
  ON contacts(referred_by_contact_id)
  WHERE referred_by_contact_id IS NOT NULL;

-- Enrichment columns (used by Phase 10 auto-enrichment)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS timezone TEXT;
