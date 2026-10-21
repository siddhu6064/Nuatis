-- Platform / internal-ops incidents. Audience is the Nuatis team, not merchants.
--
-- THERE IS NO tenant_id ON platform_incidents, AND THAT IS DELIBERATE.
-- An incident here is about Nuatis itself — the API is down, a migration locked
-- a table. Adding a tenant_id would make this look like a tenant-scoped table
-- and invite a tenant-scoped read, which is the exact confusion the two-table
-- split exists to prevent. Affected merchants are recorded in
-- platform_incident_tenants instead. Do not "fix" this.
CREATE TABLE IF NOT EXISTS platform_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('sev1','sev2','sev3','sev4')),
  status            text NOT NULL DEFAULT 'detected'
                      CHECK (status IN ('detected','acknowledged','mitigating',
                                        'resolved','postmortem_due','closed')),
  title             text NOT NULL,
  summary           text,
  component         text CHECK (component IN ('api','pos-socket','database','worker','web')),
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  mitigated_at      timestamptz,
  resolved_at       timestamptz,
  postmortem        text,
  postmortem_due_at timestamptz,
  -- Stamped at declaration from severity. Null for SEV4, which has no deadline
  -- — the ack scanner's `.lt()` never matches null, so that exclusion needs no
  -- special case.
  ack_due_at        timestamptz,
  -- Set the first time the scanner notices a missed deadline, so it escalates
  -- once rather than every five minutes.
  ack_breached_at   timestamptz,
  -- The ONLY two columns any merchant can ever see. Null by default: nothing
  -- reaches a tenant until someone deliberately writes this text and publishes
  -- it. title/summary/component and the event timeline are internal and are
  -- never read by the tenant-facing endpoint.
  customer_message  text,
  customer_message_published_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_incidents_reference
  ON platform_incidents(reference);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_status
  ON platform_incidents(status, detected_at DESC);
-- Ack-deadline scanner: open incidents that have not yet been flagged.
CREATE INDEX IF NOT EXISTS idx_platform_incidents_ack_open
  ON platform_incidents(ack_due_at)
  WHERE acknowledged_at IS NULL AND ack_breached_at IS NULL
    AND status NOT IN ('resolved','postmortem_due','closed');

-- Which merchants were affected. A join table rather than a jsonb array,
-- because "was this tenant affected by anything last month" is a question a
-- support conversation actually asks.
CREATE TABLE IF NOT EXISTS platform_incident_tenants (
  incident_id uuid NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  impact      text NOT NULL DEFAULT 'partial' CHECK (impact IN ('full','partial','none')),
  PRIMARY KEY (incident_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_incident_tenants_tenant
  ON platform_incident_tenants(tenant_id);

-- Append-only timeline. The postmortem is written FROM this, so it has to be
-- captured while the incident is live — reconstructing it afterwards from
-- memory is how postmortems become fiction.
CREATE TABLE IF NOT EXISTS platform_incident_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   uuid NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind    text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','system')),
  kind          text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_platform_incident_events_incident
  ON platform_incident_events(incident_id, at);

-- On-call rota. A shift is a half-open interval [starts_at, ends_at).
CREATE TABLE IF NOT EXISTS platform_oncall_shifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  -- An override wins over a regular shift covering the same instant: someone
  -- swapped out at short notice and the rota should say so without deleting
  -- the original.
  is_override boolean NOT NULL DEFAULT false,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_platform_oncall_window
  ON platform_oncall_shifts(starts_at, ends_at);

-- RLS: these tables are reached only through the service-role client behind
-- requirePlatformOwner. Enabling RLS with no permissive policy means a leaked
-- anon key reads nothing, which is the correct default for internal data.
ALTER TABLE platform_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_incident_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_oncall_shifts ENABLE ROW LEVEL SECURITY;
