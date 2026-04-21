-- Review automation on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_automation_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_delay_minutes INTEGER DEFAULT 120;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_message_template TEXT DEFAULT 'Thanks {{first_name}}! We''d love a quick Google review: {{review_url}}';

-- Notification preferences (event × channel matrix)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
  "new_contact": {"push": true, "sms": false, "email": false},
  "appointment_booked": {"push": true, "sms": true, "email": false},
  "appointment_completed": {"push": true, "sms": false, "email": false},
  "quote_viewed": {"push": true, "sms": false, "email": false},
  "quote_accepted": {"push": true, "sms": true, "email": false},
  "deposit_paid": {"push": true, "sms": true, "email": false},
  "new_sms": {"push": true, "sms": false, "email": false},
  "task_due": {"push": true, "sms": false, "email": false},
  "review_sent": {"push": true, "sms": false, "email": false},
  "form_submitted": {"push": true, "sms": false, "email": false},
  "low_lead_score": {"push": true, "sms": false, "email": false},
  "contact_assigned": {"push": true, "sms": false, "email": false}
}'::jsonb;

-- User assignment
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts(tenant_id, assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned ON deals(tenant_id, assigned_to_user_id);

-- Review request tracking
CREATE TABLE review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  appointment_id UUID REFERENCES appointments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'clicked', 'reviewed')),
  sent_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON review_requests
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()::text));
CREATE INDEX idx_review_requests_tenant ON review_requests(tenant_id);
CREATE INDEX idx_review_requests_contact ON review_requests(contact_id);
