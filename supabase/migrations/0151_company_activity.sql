-- Companies CRM parity: lets a company have its own activity feed (merge
-- events, notes, etc.) the same way contacts already do — activity_log rows
-- can now optionally point at a company instead of / in addition to a contact.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_activity_log_company ON activity_log(company_id);
