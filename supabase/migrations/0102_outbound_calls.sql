CREATE TABLE outbound_call_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'manual', 'lead_status', 'deal_stage', 'no_response', 'follow_up_sequence'
  )),
  trigger_config JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dialing', 'connected', 'completed', 'failed', 'no_answer', 'cancelled')),
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON outbound_call_jobs(tenant_id, status);
CREATE INDEX ON outbound_call_jobs(tenant_id, scheduled_at);
CREATE INDEX ON outbound_call_jobs(contact_id);
