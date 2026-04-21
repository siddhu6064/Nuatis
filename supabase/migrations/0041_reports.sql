CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  object TEXT NOT NULL CHECK (object IN ('contacts', 'appointments', 'deals', 'quotes', 'activity_log', 'tasks')),
  metric TEXT NOT NULL CHECK (metric IN ('count', 'sum', 'avg', 'min', 'max')),
  metric_field TEXT,
  group_by TEXT NOT NULL,
  filters JSONB DEFAULT '[]',
  date_range TEXT DEFAULT 'last_30_days' CHECK (date_range IN ('today', 'last_7_days', 'last_30_days', 'last_90_days', 'last_12_months', 'this_month', 'this_quarter', 'this_year', 'all_time', 'custom')),
  date_from DATE,
  date_to DATE,
  chart_type TEXT NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'line', 'pie', 'table', 'number')),
  pinned_to_dashboard BOOLEAN DEFAULT false,
  pin_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON reports
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()::text));
CREATE INDEX idx_reports_tenant ON reports(tenant_id);
CREATE INDEX idx_reports_pinned ON reports(tenant_id, pinned_to_dashboard) WHERE pinned_to_dashboard = true;
