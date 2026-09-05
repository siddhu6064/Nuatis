-- ============================================================
--  0158 — Staff ↔ Service skill mapping
--  Lets a service require specific staff, surfaced as a staff
--  picker on the public booking page and used for staff-aware
--  availability filtering.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_services (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_services_unique
  ON staff_services(tenant_id, staff_id, service_id);

CREATE INDEX IF NOT EXISTS idx_staff_services_service
  ON staff_services(tenant_id, service_id);

ALTER TABLE staff_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_services
  USING (tenant_id = current_tenant_id());
