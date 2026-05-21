-- Migration: 0101_webchat
-- Webchat embeddable widget system: sessions, messages, tenant/location config

-- 1. webchat_sessions table
CREATE TABLE webchat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  session_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  visitor_name TEXT,
  visitor_email TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON webchat_sessions(tenant_id, status);
CREATE INDEX ON webchat_sessions(session_token);
CREATE INDEX ON webchat_sessions(tenant_id, created_at DESC);

-- 2. webchat_messages table
CREATE TABLE webchat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES webchat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'agent')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON webchat_messages(session_id, created_at);

-- 3. Add webchat_config to locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS webchat_config JSONB DEFAULT '{}'::jsonb;

-- 4. Add webchat settings columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webchat_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webchat_greeting TEXT DEFAULT 'Hi! How can we help you today?';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webchat_color TEXT DEFAULT '#0d9488';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS webchat_position TEXT DEFAULT 'bottom-right';
