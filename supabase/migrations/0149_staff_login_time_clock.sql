-- Staff self-service login: links a staff_members roster row to a real
-- users/Supabase-Auth login, adds pay-rate storage, and a time clock.

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pay_type text CHECK (pay_type IN ('hourly', 'salary')),
  ADD COLUMN IF NOT EXISTS hourly_rate_cents integer,
  ADD COLUMN IF NOT EXISTS salary_cents integer;

-- One login per staff row, one staff row per login.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_user_id
  ON staff_members(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS time_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  shift_id       uuid REFERENCES shifts(id) ON DELETE SET NULL,
  clock_in_at    timestamptz NOT NULL,
  clock_out_at   timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_staff
  ON time_entries(tenant_id, staff_id, clock_in_at);

-- At most one open (not-yet-clocked-out) entry per staff member.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_open
  ON time_entries(staff_id) WHERE clock_out_at IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON time_entries USING (tenant_id = current_tenant_id());
