-- 0201_incident_sla_breach
-- Marks the first time the SLA scanner noticed a breach.
--
-- Without it the scanner re-reports the same overdue incident every 15 minutes
-- until someone resolves it, which is how a team learns to mute the alert — and
-- a muted SLA is decorative.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

-- The scanner's working set: live, past due, not yet reported.
CREATE INDEX IF NOT EXISTS idx_incidents_sla_unbreached
  ON incidents(sla_due_at)
  WHERE sla_breached_at IS NULL AND status NOT IN ('resolved','cancelled');
