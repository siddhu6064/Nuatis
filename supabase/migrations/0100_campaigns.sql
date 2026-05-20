CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'email' CHECK (type IN ('email', 'sms')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'paused')),
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  smart_list_id UUID REFERENCES smart_lists(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON campaigns(tenant_id, status);
CREATE INDEX ON campaigns(tenant_id, scheduled_at);

CREATE TABLE campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'suppressed')),
  resend_email_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE(campaign_id, contact_id)
);
CREATE INDEX ON campaign_recipients(campaign_id, status);
CREATE INDEX ON campaign_recipients(contact_id);
CREATE INDEX ON campaign_recipients(resend_email_id);
