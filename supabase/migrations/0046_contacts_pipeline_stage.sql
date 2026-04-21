-- Add pipeline_stage text column to contacts
-- Referenced extensively in contacts.ts, pipelines.ts, search.ts
-- Was missing from initial schema causing 500 errors on /api/contacts

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_pipeline_stage 
ON contacts(tenant_id, pipeline_stage);
