CREATE TABLE calendar_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  assignment_mode text DEFAULT 'round_robin',
  last_assigned_index int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE calendar_group_members (
  group_id uuid NOT NULL REFERENCES calendar_groups(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  position int DEFAULT 0,
  PRIMARY KEY (group_id, location_id)
);

CREATE INDEX ON calendar_groups(tenant_id);
CREATE INDEX ON calendar_group_members(group_id);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_group_id uuid REFERENCES calendar_groups(id) ON DELETE SET NULL;
