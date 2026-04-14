-- 0003_knowledge_base.sql
-- Adds a knowledge_base table for per-tenant FAQ/content that gets embedded
-- and injected into Maya's system prompt via pgvector similarity search.
-- Uses Google text-embedding-004 (768 dimensions).
--
-- NOTE: pgvector extension is already enabled in 0001_initial_schema.sql.
--       This migration adds a NEW table alongside the existing knowledge_docs/knowledge_chunks
--       tables (which use 1536-dim OpenAI embeddings). This table uses 768-dim Google embeddings.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE knowledge_base (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  content       text NOT NULL,
  category      text DEFAULT 'general',
  embedding     vector(768),
  token_count   integer,
  is_active     boolean DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

COMMENT ON TABLE knowledge_base IS 'Per-tenant FAQ/content entries with Google text-embedding-004 vectors for RAG injection into Maya system prompt';
COMMENT ON COLUMN knowledge_base.category IS 'One of: general, services, pricing, policies, faq, hours';
COMMENT ON COLUMN knowledge_base.embedding IS '768-dim vector from Google text-embedding-004';
COMMENT ON COLUMN knowledge_base.token_count IS 'Approximate token count (chars / 4)';

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_knowledge_base_tenant ON knowledge_base(tenant_id);
CREATE INDEX idx_knowledge_base_active ON knowledge_base(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_knowledge_base_embedding ON knowledge_base
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON knowledge_base
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
-- Reuse the set_updated_at() trigger function from 0001_initial_schema.sql

CREATE TRIGGER trg_knowledge_base_updated_at
  BEFORE UPDATE ON knowledge_base
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ── RPC: match_knowledge ──────────────────────────────────────────────────────
-- Cosine similarity search used by the embeddings service.
-- Bypasses RLS (SECURITY DEFINER) since tenant_id is passed explicitly.

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding   vector(768),
  match_tenant_id   uuid,
  match_count       int DEFAULT 5,
  match_threshold   float DEFAULT 0.5
)
RETURNS TABLE (
  id          uuid,
  title       text,
  content     text,
  category    text,
  similarity  float
)
AS $$
  SELECT
    kb.id,
    kb.title,
    kb.content,
    kb.category,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE kb.tenant_id = match_tenant_id
    AND kb.is_active = true
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
