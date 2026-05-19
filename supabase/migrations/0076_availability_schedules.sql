CREATE TABLE availability_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  timezone text DEFAULT 'America/Chicago',
  hours jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX ON availability_schedules(tenant_id);

ALTER TABLE locations ADD COLUMN IF NOT EXISTS availability_schedule_id uuid REFERENCES availability_schedules(id) ON DELETE SET NULL;
