-- 0014_analytics_events.sql
-- PLG funnel tracking for Maya → Suite conversion analytics.

CREATE TABLE analytics_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenants(id),
  event_name text NOT NULL,
  properties jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_analytics_events_tenant  ON analytics_events(tenant_id);
CREATE INDEX idx_analytics_events_name    ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON analytics_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
