CREATE TABLE email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID REFERENCES contacts(id),
  email_account_id UUID REFERENCES user_email_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  tracking_token UUID DEFAULT gen_random_uuid(),
  opened_at TIMESTAMPTZ,
  open_count INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'oauth' CHECK (source IN ('oauth', 'bcc')),
  template_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON email_messages
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));

CREATE INDEX idx_email_messages_contact ON email_messages(contact_id, created_at DESC);
CREATE INDEX idx_email_messages_tracking ON email_messages(tracking_token);
CREATE INDEX idx_email_messages_tenant ON email_messages(tenant_id);
