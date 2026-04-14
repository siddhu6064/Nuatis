import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: string
  similarity: number
}

export interface KnowledgeRecord {
  id: string
  title: string
  content: string
  category: string
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getGenAI(): GoogleGenAI {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set')
  return new GoogleGenAI({ apiKey })
}

// ── Generate embedding ────────────────────────────────────────────────────────

/**
 * Generate a 768-dim embedding vector using Google text-embedding-004.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const ai = getGenAI()

  const result = await ai.models.embedContent({
    model: 'text-embedding-004',
    contents: text,
  })

  const values = result.embeddings?.[0]?.values
  if (!values || values.length === 0) {
    throw new Error('Embedding response contained no values')
  }

  console.info(
    `[embeddings] generated embedding for ${text.length} chars → ${values.length} dimensions`
  )
  return values
}

// ── Search knowledge base ─────────────────────────────────────────────────────

/**
 * Semantic search across a tenant's knowledge base entries using cosine similarity.
 */
export async function searchKnowledgeBase(
  tenantId: string,
  query: string,
  limit: number = 5
): Promise<KnowledgeEntry[]> {
  const embedding = await generateEmbedding(query)
  const supabase = getSupabase()

  // Call the match_knowledge RPC function — pass embedding as string for pgvector
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: JSON.stringify(embedding),
    match_tenant_id: tenantId,
    match_count: limit,
    match_threshold: 0.5,
  })

  if (error) {
    console.error(`[embeddings] search error: ${error.message}`)
    return []
  }

  const results: KnowledgeEntry[] = (data ?? []).map(
    (row: {
      id: string
      title: string
      content: string
      category: string
      similarity: number
    }) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      similarity: row.similarity,
    })
  )

  const topScore = results.length > 0 ? results[0]!.similarity.toFixed(3) : 'n/a'
  console.info(
    `[embeddings] search for tenant=${tenantId}: ${results.length} matches (top similarity: ${topScore})`
  )

  return results
}

// ── Fetch all active knowledge entries (for system prompt injection) ──────────

/**
 * Fetch all active knowledge entries for a tenant — no embedding search,
 * just a direct query ordered by category. Used for system prompt injection.
 */
export async function getAllKnowledgeEntries(
  tenantId: string,
  limit: number = 20
): Promise<KnowledgeRecord[]> {
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('knowledge_base')
    .select('id, title, content, category, created_at')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('category')
    .order('created_at')
    .limit(limit)

  if (error) {
    console.error(`[embeddings] getAllKnowledgeEntries error: ${error.message}`)
    return []
  }

  return (data ?? []) as KnowledgeRecord[]
}

// ── Upsert knowledge entry ────────────────────────────────────────────────────

/**
 * Insert a new knowledge entry with its embedding vector.
 * Returns the new entry's ID.
 */
export async function upsertKnowledgeEntry(
  tenantId: string,
  title: string,
  content: string,
  category: string = 'general'
): Promise<string> {
  const embedding = await generateEmbedding(content)
  const tokenCount = Math.ceil(content.length / 4)
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('knowledge_base')
    .insert({
      tenant_id: tenantId,
      title,
      content,
      category,
      embedding: JSON.stringify(embedding),
      token_count: tokenCount,
    })
    .select('id')
    .single()

  if (error) {
    console.error(`[embeddings] upsert error: ${error.message}`)
    throw new Error(`Failed to upsert knowledge entry: ${error.message}`)
  }

  console.info(
    `[embeddings] upserted knowledge entry: id=${data.id} title="${title}" tenant=${tenantId}`
  )
  return data.id as string
}
