-- Accounting-software export: chart-of-accounts mapping for expense
-- categories, consumed by the new /api/accounting-export route.

ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS gl_code text;
