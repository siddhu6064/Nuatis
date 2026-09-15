-- 0197_pos_cash_drawer
-- Cash drawer shift sessions and the individual cash movements within them.

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  opened_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_float   numeric(10,2) NOT NULL DEFAULT 0,
  -- Counted by the cashier at close; NULL until then.
  counted_total   numeric(10,2),
  -- Computed at close from opening_float plus the session's cash events.
  expected_total  numeric(10,2),
  -- counted minus expected. Positive = over, negative = short.
  variance        numeric(10,2),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('sale','refund','paid_in','paid_out','drop')),
  -- Always stored positive; `type` carries the direction. A single signed
  -- column invites double-negation bugs when summing a drawer.
  amount      numeric(10,2) NOT NULL CHECK (amount >= 0),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant ON cash_drawer_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_location_open
  ON cash_drawer_sessions(location_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_cash_events_session ON cash_events(session_id);
CREATE INDEX IF NOT EXISTS idx_cash_events_tenant ON cash_events(tenant_id);

-- At most one open drawer per location. Partial unique index, so closed
-- sessions do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_drawer_per_location
  ON cash_drawer_sessions(location_id)
  WHERE closed_at IS NULL;

ALTER TABLE cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_drawer_sessions;
CREATE POLICY tenant_isolation ON cash_drawer_sessions USING (tenant_id = current_tenant_id());

ALTER TABLE cash_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cash_events;
CREATE POLICY tenant_isolation ON cash_events USING (tenant_id = current_tenant_id());
