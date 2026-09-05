-- Subtasks, a single "blocked by" dependency, and recurring tasks — every
-- task was previously a flat, one-off item with no way to sequence or repeat.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS depends_on_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

CREATE TABLE recurring_task_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title               text NOT NULL,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  priority            text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  frequency           text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  day_of_week         integer CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month        integer CHECK (day_of_month BETWEEN 1 AND 31),
  enabled             boolean NOT NULL DEFAULT true,
  last_generated_at   timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_task_rules_tenant ON recurring_task_rules(tenant_id);
CREATE INDEX idx_recurring_task_rules_enabled ON recurring_task_rules(enabled) WHERE deleted_at IS NULL;

ALTER TABLE recurring_task_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_task_rules USING (tenant_id = current_tenant_id());

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_rule_id uuid REFERENCES recurring_task_rules(id) ON DELETE SET NULL;
