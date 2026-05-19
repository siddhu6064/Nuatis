CREATE TABLE IF NOT EXISTS scheduled_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  frequency text NOT NULL,
  day_of_week int,
  day_of_month int,
  recipients text[] NOT NULL,
  enabled boolean DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_reports_tenant_id_idx ON scheduled_reports(tenant_id);
CREATE INDEX IF NOT EXISTS scheduled_reports_enabled_idx ON scheduled_reports(enabled) WHERE enabled = true;
