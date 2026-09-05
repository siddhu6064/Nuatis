-- Board/kanban view for tasks — status was done-or-not only (completed_at),
-- with no intermediate "in progress" state a board could use as a column.
-- completed_at stays the source of truth for "done" (the dependency-block
-- check in tasks.ts reads it); status is kept in sync with it server-side.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done'));

UPDATE tasks SET status = 'done' WHERE completed_at IS NOT NULL AND status != 'done';
