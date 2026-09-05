-- Per-tenant currency, mirroring tenants.timezone's existing default-column
-- shape. USD was a literal string hardcoded into Square payment calls on
-- quotes — this makes it a real per-tenant setting instead.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
