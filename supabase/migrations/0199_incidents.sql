-- 0199_incidents
-- Tenant-scoped incident tracking: the general module plus the POS surface.
-- Deliberately NOT the same table as platform incidents (see
-- docs/superpowers/specs/2026-09-15-incidents-platform-design.md) — a shared
-- table would put an "and not a platform incident" predicate on every tenant
-- read, and these routes run on the service-role key, which bypasses RLS.

CREATE TABLE IF NOT EXISTS incident_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key              text NOT NULL,
  label            text NOT NULL,
  default_severity text NOT NULL DEFAULT 'medium'
                     CHECK (default_severity IN ('low','medium','high','critical')),
  -- Wastage always has a cost; a logged complaint may not.
  requires_cost    boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS incidents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference              text NOT NULL,
  type_key               text NOT NULL,
  severity               text NOT NULL DEFAULT 'medium'
                           CHECK (severity IN ('low','medium','high','critical')),
  status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','triaged','in_progress','resolved','cancelled')),
  title                  text NOT NULL,
  description            text,
  -- Integer cents, not numeric(10,2). Incidents have no generated columns to
  -- stay compatible with, and integer cents removes a conversion at every
  -- boundary. All arithmetic goes through @nuatis/pos-core.
  cost_cents             integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  location_id            uuid REFERENCES locations(id) ON DELETE SET NULL,
  order_id               uuid REFERENCES orders(id) ON DELETE SET NULL,
  kitchen_ticket_id      uuid REFERENCES kitchen_tickets(id) ON DELETE SET NULL,
  -- Two reporter columns because the register authenticates a staff_members row
  -- by PIN while the dashboard authenticates a users row. Different identity
  -- spaces; collapsing them would mean inventing a user for every cashier.
  reported_by_staff_id   uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  reported_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  authorised_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  assigned_to_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  sla_due_at             timestamptz,
  resolved_at            timestamptz,
  root_cause             text,
  resolution_notes       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  when_event      text NOT NULL CHECK (when_event IN ('created','breached','unassigned')),
  match_type_key  text,
  match_severity  text CHECK (match_severity IN ('low','medium','high','critical')),
  action          text NOT NULL CHECK (action IN ('assign_to','notify_owner')),
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  delay_minutes   integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Status changes, assignment, authorisation and resolution each
-- write one row. This is what makes an incident auditable, which matters most
-- for the ones with money attached.
CREATE TABLE IF NOT EXISTS incident_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_kind  text NOT NULL CHECK (actor_kind IN ('staff','user','system')),
  actor_id    uuid,
  kind        text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Follow-up work is an ordinary task pointing back at its cause. No task field
-- is duplicated onto incidents.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_id uuid
  REFERENCES incidents(id) ON DELETE SET NULL;

-- Per-tenant manager-authorisation threshold, in cents. NULL means the $10
-- default in lib/incidents.ts.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS incident_auth_threshold_cents integer;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created ON incidents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_order ON incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_ticket ON incidents(kitchen_ticket_id);
CREATE INDEX IF NOT EXISTS idx_incidents_sla ON incidents(sla_due_at)
  WHERE status NOT IN ('resolved','cancelled');
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_types_tenant ON incident_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_rules_tenant ON incident_rules(tenant_id, when_event);
CREATE INDEX IF NOT EXISTS idx_tasks_incident ON tasks(incident_id);

-- Reference numbers restart per tenant. The unique index is the real guard; the
-- counter read in lib/incidents.ts only picks the next number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_reference_per_tenant
  ON incidents(tenant_id, reference);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incidents;
CREATE POLICY tenant_isolation ON incidents USING (tenant_id = current_tenant_id());

ALTER TABLE incident_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_types;
CREATE POLICY tenant_isolation ON incident_types USING (tenant_id = current_tenant_id());

ALTER TABLE incident_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_rules;
CREATE POLICY tenant_isolation ON incident_rules USING (tenant_id = current_tenant_id());

ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_events;
CREATE POLICY tenant_isolation ON incident_events USING (tenant_id = current_tenant_id());
