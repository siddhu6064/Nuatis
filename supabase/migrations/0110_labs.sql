-- Enable pgcrypto for gen_random_bytes (used by gift_cards.code default)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- G53: Labs config column on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS labs_config JSONB DEFAULT '{}'::jsonb;

-- G54: In-app announcements
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('feature', 'maintenance', 'tip', 'update')),
  cta_label TEXT,
  cta_url TEXT,
  starts_at TIMESTAMPTZ DEFAULT now(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO announcements (title, body, type, cta_label, cta_url) VALUES
('AI Campaigns are here', 'Send AI-generated email campaigns to your contact segments. Set up your brand voice first.', 'feature', 'Set up Brand Voice', '/settings/brand-profile'),
('Maya now makes outbound calls', 'Enable outbound calling to have Maya proactively reach out to leads.', 'feature', 'Try it now', '/outbound-calls');

-- G86: Gift cards
CREATE TABLE gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE DEFAULT upper(left(replace(gen_random_uuid()::text, '-', ''), 12)),
  amount_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'cancelled')),
  recipient_name TEXT,
  recipient_email TEXT,
  purchased_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON gift_cards(tenant_id, status);
CREATE INDEX ON gift_cards(code);

-- G90: Media library
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON media_files(tenant_id);
