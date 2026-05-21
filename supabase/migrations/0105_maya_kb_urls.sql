-- maya_kb_urls: stores crawled website content for Maya's knowledge base
CREATE TABLE maya_kb_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'crawling', 'ready', 'error')),
  pages_crawled INTEGER DEFAULT 0,
  extracted_text TEXT,
  error_message TEXT,
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, url)
);
CREATE INDEX ON maya_kb_urls(tenant_id);
