CREATE TABLE trigger_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK (action IN (
    'confirm_appointment',
    'cancel_appointment',
    'mark_contacted',
    'mark_won',
    'mark_lost',
    'custom_webhook'
  )),
  action_config JSONB DEFAULT '{}'::jsonb,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON trigger_links(tenant_id);
CREATE INDEX ON trigger_links(slug);

CREATE TABLE trigger_link_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_link_id UUID NOT NULL REFERENCES trigger_links(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  clicked_at TIMESTAMPTZ DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX ON trigger_link_events(trigger_link_id);
CREATE INDEX ON trigger_link_events(contact_id);
