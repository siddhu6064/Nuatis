-- Migration: calls table
-- Run this in the Supabase SQL editor for project zhykavqqvvvpfpgtipzp.supabase.co

CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone_number_from text,
  phone_number_to text,
  duration_seconds integer DEFAULT 0,
  language text DEFAULT 'unknown',
  outcome text DEFAULT 'completed',
  transcript text,
  recording_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON calls
  USING (tenant_id = (
    SELECT tenant_id FROM users
    WHERE authjs_user_id = auth.uid()
  ));

CREATE INDEX calls_tenant_id_idx ON calls(tenant_id);
CREATE INDEX calls_created_at_idx ON calls(created_at DESC);
