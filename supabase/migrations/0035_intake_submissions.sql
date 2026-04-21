CREATE TABLE intake_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  form_id UUID NOT NULL REFERENCES intake_forms(id),
  contact_id UUID REFERENCES contacts(id),
  appointment_id UUID REFERENCES appointments(id),
  data JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON intake_submissions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()::text));
CREATE INDEX idx_intake_submissions_tenant ON intake_submissions(tenant_id);
CREATE INDEX idx_intake_submissions_contact ON intake_submissions(contact_id);
CREATE INDEX idx_intake_submissions_form ON intake_submissions(form_id);
