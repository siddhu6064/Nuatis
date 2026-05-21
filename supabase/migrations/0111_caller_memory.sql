-- 0111_caller_memory.sql
-- Per-caller persistent memory for Maya AI receptionist.
-- Stores extracted facts and summaries merged across all calls from a given phone number.

CREATE TABLE caller_memory (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone        text NOT NULL,  -- E.164 format e.g. +15125551234
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  call_count   integer NOT NULL DEFAULT 1,
  last_call_at timestamptz,
  facts        jsonb NOT NULL DEFAULT '{}',
  summary      text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),

  UNIQUE(tenant_id, phone)
);

-- facts column stores structured caller knowledge, e.g.:
-- {
--   "name": "John", "preferred_name": "Johnny",
--   "last_appointment_type": "crown consultation",
--   "last_appointment_date": "2026-04-12",
--   "pending_needs": ["reschedule crown"],
--   "preferences": ["morning slots", "Dr. Martinez"],
--   "sentiment": "positive", "language": "en",
--   "topics": ["appointment booking", "insurance"]
-- }

CREATE INDEX idx_caller_memory_tenant_phone ON caller_memory(tenant_id, phone);

ALTER TABLE caller_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON caller_memory
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
