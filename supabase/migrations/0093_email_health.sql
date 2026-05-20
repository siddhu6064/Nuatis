CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  email_address TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sent', 'delivered', 'opened', 'clicked',
    'bounced_hard', 'bounced_soft', 'complained', 'unsubscribed'
  )),
  resend_email_id TEXT,
  bounce_type TEXT,
  bounce_subtype TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON email_events(tenant_id, event_type, created_at DESC);
CREATE INDEX ON email_events(email_address, event_type);
CREATE INDEX ON email_events(contact_id);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_risk_score INTEGER DEFAULT 0
  CHECK (email_risk_score BETWEEN 0 AND 100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_status TEXT DEFAULT 'ok'
  CHECK (email_status IN ('ok', 'soft_bounce', 'hard_bounce', 'complained', 'unsubscribed'));
