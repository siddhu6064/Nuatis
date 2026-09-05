-- ============================================================
--  0144 — Customer-facing NPS survey
--  tenants.nps_score/nps_submitted_at/nps_dismissed (nps.ts) is Nuatis's OWN
--  product feedback about the tenant's satisfaction with Nuatis. This is a
--  separate, new feature: the tenant's own customers rating THEM, triggered
--  post-appointment, mirroring the review-request automation shape.
-- ============================================================

CREATE TABLE IF NOT EXISTS nps_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'responded')),
  score          smallint CHECK (score BETWEEN 0 AND 10),
  comment        text,
  sent_at        timestamptz,
  responded_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON nps_responses;
CREATE POLICY tenant_isolation ON nps_responses USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_nps_responses_tenant ON nps_responses (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_nps_responses_appointment ON nps_responses (appointment_id);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_survey_automation_enabled boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nps_survey_delay_minutes integer DEFAULT 120;
