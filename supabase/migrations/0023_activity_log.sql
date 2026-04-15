-- ============================================================
--  0023 — Activity Log + Tasks
--  Phase 8 Wk 55-56: timeline, notes, task management
-- ============================================================

-- ── ACTIVITY_LOG ────────────────────────────────────────────

CREATE TABLE activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,         -- call | note | email | sms | appointment | quote | stage_change | task | system
  body        TEXT,                  -- human-readable summary
  metadata    JSONB NOT NULL DEFAULT '{}',
  actor_type  TEXT NOT NULL DEFAULT 'system',  -- ai | user | system | contact
  actor_id    UUID,                  -- user id when actor_type = 'user'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON activity_log
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_activity_log_tenant_contact_time
  ON activity_log (tenant_id, contact_id, created_at DESC);

CREATE INDEX idx_activity_log_tenant_type_time
  ON activity_log (tenant_id, type, created_at DESC);

CREATE INDEX idx_activity_log_contact_time
  ON activity_log (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;


-- ── TASKS ───────────────────────────────────────────────────

CREATE TABLE tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  due_date            TIMESTAMPTZ,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at        TIMESTAMPTZ,
  priority            TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high
  reminder_job_id     TEXT,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tasks
  USING (tenant_id = current_tenant_id());

-- Active tasks by tenant (most common query)
CREATE INDEX idx_tasks_tenant_active
  ON tasks (tenant_id, completed_at)
  WHERE completed_at IS NULL;

-- Active tasks by due date
CREATE INDEX idx_tasks_tenant_due
  ON tasks (tenant_id, due_date)
  WHERE completed_at IS NULL;

-- Tasks by contact
CREATE INDEX idx_tasks_contact
  ON tasks (contact_id)
  WHERE contact_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_tasks_updated_at();
