-- ============================================================
--  0049 — Staff members + shifts + quote_line_items FK
--  Phase 11 Wk 87-88: staff scheduling CRM sub-feature
-- ============================================================

-- ── SECTION A: staff_members ────────────────────────────────

CREATE TABLE staff_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  role          text NOT NULL,
  email         text,
  phone         text,
  color_hex     text NOT NULL DEFAULT '#6366F1',
  is_active     boolean NOT NULL DEFAULT true,
  availability  jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN staff_members.availability IS
  'Shape: {"mon":{"enabled":bool,"start":"HH:MM","end":"HH:MM"},"tue":...,"wed":...,"thu":...,"fri":...,"sat":...,"sun":...}';

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON staff_members
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_staff_members_tenant_active
  ON staff_members (tenant_id) WHERE is_active = true;

-- Reuse set_updated_at() from 0001_initial_schema.sql
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── SECTION B: shifts ───────────────────────────────────────
-- Immutable once created; delete+recreate to change. No updated_at.

CREATE TABLE shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  date        date NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_time_order_chk CHECK (end_time > start_time),
  CONSTRAINT shifts_no_duplicate UNIQUE (tenant_id, staff_id, date, start_time)
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON shifts
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_shifts_tenant_staff_date
  ON shifts (tenant_id, staff_id, date);

CREATE INDEX idx_shifts_tenant_date
  ON shifts (tenant_id, date);


-- ── SECTION C: alter existing tables ────────────────────────

-- 1. Link quote line items to inventory items
ALTER TABLE quote_line_items
  ADD COLUMN inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL;

-- 2. Tenant opt-in flag: auto-deduct inventory when a quote line ships.
--    NOTE: tenants table does not yet have a generic `settings` jsonb column
--    (existing jsonb columns are cpq_settings, modules, notification_prefs).
--    Create the column here so future tenant-level feature flags share one bag.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.settings IS
  'General tenant-level feature flags + preferences. Keys merged over time; consumers must tolerate missing keys. inventory_auto_deduct (bool): when true, quote fulfillment decrements inventory_items.quantity via the inventory_item_id FK on quote_line_items.';

-- Backfill the inventory_auto_deduct key without overwriting any existing settings.
UPDATE tenants
   SET settings = COALESCE(settings, '{}'::jsonb) || '{"inventory_auto_deduct": false}'::jsonb
 WHERE settings IS NULL OR NOT (settings ? 'inventory_auto_deduct');
