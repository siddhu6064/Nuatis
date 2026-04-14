import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { upsertKnowledgeEntry, searchKnowledgeBase } from '../services/embeddings.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const CreateKnowledgeSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
  category: z.string().max(100).optional().default('general'),
})

const SearchKnowledgeSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(20).optional().default(5),
})

// ── POST /api/knowledge — create a new knowledge entry ───────────────────────

router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  const parsed = CreateKnowledgeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() })
    return
  }

  const { title, content, category } = parsed.data

  try {
    const id = await upsertKnowledgeEntry(authed.tenantId, title, content, category)
    res.status(201).json({ id, title, category })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[knowledge] POST error: ${msg}`)
    res.status(500).json({ error: 'Failed to create knowledge entry' })
  }
})

// ── GET /api/knowledge — list all entries for the tenant ─────────────────────

router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('knowledge_base')
    .select('id, title, content, category, created_at')
    .eq('tenant_id', authed.tenantId)
    .eq('is_active', true)
    .order('category')
    .order('created_at')

  if (error) {
    console.error(`[knowledge] GET error: ${error.message}`)
    res.status(500).json({ error: 'Failed to fetch knowledge entries' })
    return
  }

  res.json(data ?? [])
})

// ── DELETE /api/knowledge/:id — soft delete ──────────────────────────────────

router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { error } = await supabase
    .from('knowledge_base')
    .update({ is_active: false })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    console.error(`[knowledge] DELETE error: ${error.message}`)
    res.status(500).json({ error: 'Failed to delete knowledge entry' })
    return
  }

  res.json({ deleted: true })
})

// ── POST /api/knowledge/search — semantic search ─────────────────────────────

router.post('/search', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  const parsed = SearchKnowledgeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() })
    return
  }

  const { query, limit } = parsed.data

  try {
    const results = await searchKnowledgeBase(authed.tenantId, query, limit)
    res.json(results)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[knowledge] search error: ${msg}`)
    res.status(500).json({ error: 'Search failed' })
  }
})

export default router
