-- 0004_voice_sessions.sql
-- Persist voice call session data for analytics, debugging, and tenant dashboards.

CREATE TABLE voice_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  stream_id       text,
  call_control_id text,
  caller_phone    text,
  caller_name     text,
  direction       text DEFAULT 'inbound',
  status          text DEFAULT 'completed',
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  duration_seconds integer,
  first_response_ms integer,
  language_detected text,
  outcome         text,                          -- booking_made | inquiry_answered | escalated | abandoned | general
  transcript      text DEFAULT '',               -- placeholder — Gemini audio-only gives empty text
  summary         text,                          -- future: AI-generated call summary
  tool_calls_made jsonb DEFAULT '[]'::jsonb,     -- array of { name, timestamp }
  booked_appointment boolean DEFAULT false,
  appointment_id  uuid REFERENCES appointments(id),
  contact_id      uuid REFERENCES contacts(id),
  escalated       boolean DEFAULT false,
  escalation_reason text,
  call_quality_mos numeric(3,2),                 -- Telnyx MOS score from call_quality_stats
  hangup_source   text,                          -- caller | system
  hangup_cause    text,                          -- normal_clearing, etc.
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_voice_sessions_tenant   ON voice_sessions(tenant_id);
CREATE INDEX idx_voice_sessions_started  ON voice_sessions(started_at DESC);
CREATE INDEX idx_voice_sessions_caller   ON voice_sessions(caller_phone);
CREATE INDEX idx_voice_sessions_outcome  ON voice_sessions(tenant_id, outcome);

-- Row Level Security
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation"
  ON voice_sessions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
