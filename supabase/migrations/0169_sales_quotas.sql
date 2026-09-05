-- Rep quota tracking on top of the existing weighted pipeline forecast.
-- period_start is always the first of a month — one quota row per rep per
-- month. quota_amount is a plain dollar NUMERIC (not cents) to match
-- deals.value's own units (see 0028_deals_companies.sql), so attainment
-- math never needs a unit conversion.

CREATE TABLE IF NOT EXISTS sales_quotas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  quota_amount  numeric(12,2) NOT NULL CHECK (quota_amount >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_quotas_user_period ON sales_quotas(tenant_id, user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_sales_quotas_tenant_period ON sales_quotas(tenant_id, period_start);

ALTER TABLE sales_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sales_quotas
  USING (tenant_id = current_tenant_id());
