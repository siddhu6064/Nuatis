-- Per-user monthly expense spending limits — no budget concept existed per
-- user or per category; a personal limit now routes to the existing expense
-- approval workflow instead of introducing a separate hard-block mechanism.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS monthly_expense_limit_cents integer
    CHECK (monthly_expense_limit_cents IS NULL OR monthly_expense_limit_cents >= 0);
