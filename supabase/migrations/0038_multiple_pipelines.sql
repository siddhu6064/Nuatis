-- Pipelines parent table
CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  pipeline_type TEXT NOT NULL DEFAULT 'contacts' CHECK (pipeline_type IN ('contacts', 'deals')),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON pipelines
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()::text));
CREATE INDEX idx_pipelines_tenant ON pipelines(tenant_id);

-- Add pipeline_id + probability to existing pipeline_stages
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS probability INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100);

-- Migrate existing stages: create a default pipeline per tenant, link stages
DO $$
DECLARE
  t RECORD;
  default_pipeline_id UUID;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM pipeline_stages LOOP
    INSERT INTO pipelines (tenant_id, name, description, is_default, pipeline_type)
    VALUES (t.tenant_id, 'Default Pipeline', 'Default contact pipeline', true, 'contacts')
    RETURNING id INTO default_pipeline_id;

    UPDATE pipeline_stages SET pipeline_id = default_pipeline_id WHERE tenant_id = t.tenant_id AND pipeline_id IS NULL;
  END LOOP;
END $$;

-- Set probability defaults based on stage name patterns
UPDATE pipeline_stages SET probability = 10 WHERE LOWER(name) LIKE '%new%' OR LOWER(name) LIKE '%inquiry%';
UPDATE pipeline_stages SET probability = 30 WHERE LOWER(name) LIKE '%contact%' OR LOWER(name) LIKE '%reach%';
UPDATE pipeline_stages SET probability = 50 WHERE LOWER(name) LIKE '%estimate%' OR LOWER(name) LIKE '%proposal%' OR LOWER(name) LIKE '%quote%';
UPDATE pipeline_stages SET probability = 70 WHERE LOWER(name) LIKE '%negotiat%' OR LOWER(name) LIKE '%follow%';
UPDATE pipeline_stages SET probability = 90 WHERE LOWER(name) LIKE '%accept%' OR LOWER(name) LIKE '%commit%';
UPDATE pipeline_stages SET probability = 100 WHERE LOWER(name) LIKE '%won%' OR LOWER(name) LIKE '%closed%' OR LOWER(name) LIKE '%complete%';
UPDATE pipeline_stages SET probability = 0 WHERE LOWER(name) LIKE '%lost%' OR LOWER(name) LIKE '%cancel%' OR LOWER(name) LIKE '%archive%';

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
