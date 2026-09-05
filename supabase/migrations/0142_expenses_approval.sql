-- ============================================================
--  0142 — Expenses: approval workflow
--  Mirrors quotes.approval_status / require_approval_above.
-- ============================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approval_status text
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approval_note text;

CREATE INDEX IF NOT EXISTS idx_expenses_approval_pending
  ON expenses (tenant_id) WHERE approval_status = 'pending';
