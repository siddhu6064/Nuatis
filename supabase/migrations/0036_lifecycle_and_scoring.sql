-- Lifecycle stage enum
DO $$ BEGIN
  CREATE TYPE lifecycle_stage AS ENUM (
    'subscriber', 'lead', 'marketing_qualified', 'sales_qualified',
    'opportunity', 'customer', 'evangelist', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add lifecycle + scoring columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_stage lifecycle_stage DEFAULT 'lead';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_grade TEXT CHECK (lead_grade IN ('A', 'B', 'C', 'D', 'F'));

-- Add check constraint for lead_score range
ALTER TABLE contacts ADD CONSTRAINT chk_lead_score_range CHECK (lead_score >= 0 AND lead_score <= 100);

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON contacts(tenant_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON contacts(tenant_id, lead_score DESC);

-- Lead scoring rules table
CREATE TABLE lead_scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL CHECK (category IN ('engagement', 'profile', 'behavior', 'decay')),
  rule_key TEXT NOT NULL,
  label TEXT NOT NULL,
  points INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, rule_key)
);

ALTER TABLE lead_scoring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON lead_scoring_rules
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()::text));
CREATE INDEX idx_lead_scoring_rules_tenant ON lead_scoring_rules(tenant_id);
