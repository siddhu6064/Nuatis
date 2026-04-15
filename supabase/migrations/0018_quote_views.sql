-- Quote view tracking
CREATE TABLE quote_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  viewed_at timestamptz DEFAULT now(),
  ip_hash text,
  user_agent text
);

CREATE INDEX idx_quote_views_quote ON quote_views(quote_id);
CREATE INDEX idx_quote_views_tenant ON quote_views(tenant_id);

ALTER TABLE quote_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON quote_views
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Track the delayed follow-up job ID on quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS followup_job_id text;
