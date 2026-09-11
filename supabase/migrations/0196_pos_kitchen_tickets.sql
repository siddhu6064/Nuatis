-- 0196_pos_kitchen_tickets
-- Kitchen tickets fired from a POS order, routed to a station, displayed and
-- bumped on the KDS.

CREATE TABLE kitchen_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NOT NULL: a ticket with no location cannot be routed to a kitchen screen
  -- without leaking across a multi-location tenant.
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- NULL station = unrouted; every KDS screen shows it.
  station       text,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','in_progress','ready','bumped')),
  ticket_number integer NOT NULL,
  -- The business day this ticket belongs to, computed by the route in the
  -- TENANT's timezone rather than derived from fired_at here. Two reasons:
  -- (1) fired_at::date is STABLE, not IMMUTABLE, so Postgres rejects it in an
  --     index expression;
  -- (2) a UTC day boundary falls at 7-8pm US Eastern, which would reset ticket
  --     numbers in the middle of dinner service.
  service_date  date NOT NULL,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  ready_at      timestamptz,
  bumped_at     timestamptz,
  bumped_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kitchen_ticket_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id          uuid NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  order_line_item_id uuid REFERENCES order_line_items(id) ON DELETE SET NULL,
  -- Name and modifiers are snapshotted at fire time. Renaming or deleting a
  -- menu item later must never rewrite what the kitchen was told to cook.
  name               text NOT NULL,
  quantity           numeric(10,2) NOT NULL DEFAULT 1,
  modifiers          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes              text,
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','ready','bumped')),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kitchen_tickets_tenant ON kitchen_tickets(tenant_id);
CREATE INDEX idx_kitchen_tickets_location_status
  ON kitchen_tickets(location_id, status);
CREATE INDEX idx_kitchen_tickets_order ON kitchen_tickets(order_id);
CREATE INDEX idx_kitchen_ticket_items_ticket ON kitchen_ticket_items(ticket_id);
CREATE INDEX idx_kitchen_ticket_items_tenant ON kitchen_ticket_items(tenant_id);

-- Ticket numbers restart per location per service day. Enforced here rather
-- than in application code so two registers firing simultaneously cannot
-- collide: the read-max-then-insert in the route is racy on its own.
CREATE UNIQUE INDEX idx_kitchen_tickets_number_per_day
  ON kitchen_tickets(location_id, service_date, ticket_number);

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_tickets USING (tenant_id = current_tenant_id());

ALTER TABLE kitchen_ticket_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_ticket_items USING (tenant_id = current_tenant_id());
