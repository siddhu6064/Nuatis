-- Chat sessions
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID REFERENCES contacts(id),
  visitor_name TEXT,
  visitor_email TEXT,
  visitor_phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'archived')),
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  unread_count INTEGER DEFAULT 0
);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON chat_sessions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_chat_sessions_tenant ON chat_sessions(tenant_id, last_message_at DESC);
CREATE INDEX idx_chat_sessions_contact ON chat_sessions(contact_id);

-- Chat messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id UUID NOT NULL REFERENCES chat_sessions(id),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'agent')),
  sender_id UUID,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON chat_messages
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);

-- Enable Supabase Realtime on chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- Chat widget settings on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chat_widget_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chat_widget_color TEXT DEFAULT '#0D9488';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chat_widget_greeting TEXT DEFAULT 'Hi there! How can we help you today?';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS chat_widget_position TEXT DEFAULT 'bottom-right' CHECK (chat_widget_position IN ('bottom-right', 'bottom-left'));

-- Data export jobs
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  tables_included TEXT[] NOT NULL,
  file_path TEXT,
  file_size_bytes BIGINT,
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON export_jobs
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_export_jobs_tenant ON export_jobs(tenant_id);
