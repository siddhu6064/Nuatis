import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── GET /api/views ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  if (!UUID_RE.test(authed.tenantId) || !UUID_RE.test(authed.userId)) {
    res.json({ views: [] })
    return
  }

  const { data, error } = await supabase
    .from('saved_views')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .or(`user_id.eq.${authed.userId},user_id.is.null`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ views: data ?? [] })
})

// ── POST /api/views ──────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const filters =
    b['filters'] && typeof b['filters'] === 'object' && !Array.isArray(b['filters'])
      ? b['filters']
      : {}

  const objectType = typeof b['object_type'] === 'string' ? b['object_type'] : 'contacts'
  const sortBy = typeof b['sort_by'] === 'string' ? b['sort_by'] : null
  const sortDir = typeof b['sort_dir'] === 'string' ? b['sort_dir'] : 'desc'
  const isDefault = b['is_default'] === true

  // If setting as default, unset others first
  if (isDefault) {
    await supabase
      .from('saved_views')
      .update({ is_default: false })
      .eq('tenant_id', authed.tenantId)
      .eq('object_type', objectType)
      .eq('is_default', true)
  }

  const { data: view, error } = await supabase
    .from('saved_views')
    .insert({
      tenant_id: authed.tenantId,
      user_id: authed.userId,
      name,
      object_type: objectType,
      filters,
      sort_by: sortBy,
      sort_dir: sortDir,
      is_default: isDefault,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(view)
})

// ── PUT /api/views/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('saved_views')
    .select('id, object_type')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'View not found' })
    return
  }

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (b['filters'] && typeof b['filters'] === 'object' && !Array.isArray(b['filters'])) {
    updates['filters'] = b['filters']
  }
  if (typeof b['sort_by'] === 'string') updates['sort_by'] = b['sort_by']
  if (typeof b['sort_dir'] === 'string') updates['sort_dir'] = b['sort_dir']

  if (b['is_default'] === true) {
    await supabase
      .from('saved_views')
      .update({ is_default: false })
      .eq('tenant_id', authed.tenantId)
      .eq('object_type', existing.object_type)
      .eq('is_default', true)
    updates['is_default'] = true
  } else if (b['is_default'] === false) {
    updates['is_default'] = false
  }

  const { data: updated, error } = await supabase
    .from('saved_views')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(updated)
})

// ── DELETE /api/views/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: existing } = await supabase
    .from('saved_views')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'View not found' })
    return
  }

  const { error } = await supabase.from('saved_views').delete().eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ deleted: true })
})

// ── PUT /api/views/reorder ───────────────────────────────────────────────────
router.put('/reorder', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const items = req.body as Array<{ id: string; sort_order: number }>

  if (!Array.isArray(items)) {
    res.status(400).json({ error: 'Body must be an array of {id, sort_order}' })
    return
  }

  for (const item of items) {
    await supabase
      .from('saved_views')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
      .eq('tenant_id', authed.tenantId)
  }

  res.json({ updated: true })
})

export default router
