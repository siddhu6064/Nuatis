import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const SHORTCUT_RE = /^[a-z0-9-]+$/i

// ── GET /api/snippets ─────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('snippets')
    .select('id, name, shortcut, body, created_at')
    .eq('tenant_id', authed.tenantId)
    .order('name', { ascending: true })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ snippets: data ?? [] })
})

// ── GET /api/snippets/search?q= ───────────────────────────────────────────────
router.get('/search', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : ''

  let query = supabase
    .from('snippets')
    .select('id, name, shortcut, body')
    .eq('tenant_id', authed.tenantId)
    .order('name', { ascending: true })
    .limit(10)

  if (q) {
    query = query.or(`shortcut.ilike.%${q}%,name.ilike.%${q}%`)
  }

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ snippets: data ?? [] })
})

// ── POST /api/snippets ────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const shortcut = typeof b['shortcut'] === 'string' ? b['shortcut'].trim().toLowerCase() : ''
  if (!shortcut) {
    res.status(400).json({ error: 'shortcut is required' })
    return
  }
  if (!SHORTCUT_RE.test(shortcut)) {
    res.status(400).json({ error: 'shortcut must be alphanumeric with dashes only (no spaces)' })
    return
  }
  if (shortcut.length > 30) {
    res.status(400).json({ error: 'shortcut must be 30 characters or fewer' })
    return
  }

  const body = typeof b['body'] === 'string' ? b['body'].trim() : ''
  if (!body) {
    res.status(400).json({ error: 'body is required' })
    return
  }

  const { data, error } = await supabase
    .from('snippets')
    .insert({ tenant_id: authed.tenantId, name, shortcut, body })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Shortcut "${shortcut}" already exists` })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({ snippet: data })
})

// ── PUT /api/snippets/:id ─────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params as { id: string }
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('snippets')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b['name'] === 'string' && b['name'].trim()) updates['name'] = b['name'].trim()
  if (typeof b['body'] === 'string' && b['body'].trim()) updates['body'] = b['body'].trim()
  if (typeof b['shortcut'] === 'string' && b['shortcut'].trim()) {
    const sc = b['shortcut'].trim().toLowerCase()
    if (!SHORTCUT_RE.test(sc)) {
      res.status(400).json({ error: 'shortcut must be alphanumeric with dashes only' })
      return
    }
    updates['shortcut'] = sc
  }

  const { data, error } = await supabase
    .from('snippets')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Shortcut already exists' })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ snippet: data })
})

// ── DELETE /api/snippets/:id ──────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params as { id: string }

  const { data: existing } = await supabase
    .from('snippets')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const { error } = await supabase.from('snippets').delete().eq('id', id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(204).send()
})

export default router
