-- PTO / time-off request workflow — a staff member requests a date range off,
-- a manager approves or rejects it. Mirrors expenses' approval_status/
-- approved_by/approved_at/approval_note shape (migration 0142).

CREATE TABLE IF NOT EXISTS time_off_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  reason         text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  approval_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_date_order_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_tenant_staff ON time_off_requests(tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_tenant_status ON time_off_requests(tenant_id, status);

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON time_off_requests
  USING (tenant_id = current_tenant_id());
