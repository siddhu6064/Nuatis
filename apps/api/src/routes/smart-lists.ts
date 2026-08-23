import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/smart-lists ─────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('smart_lists')
    .select('id, name, filters, created_at')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ lists: data ?? [] })
})

// ── POST /api/smart-lists ────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
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

  const { data, error } = await supabase
    .from('smart_lists')
    .insert({
      tenant_id: authed.tenantId,
      name,
      filters,
      created_by: authed.appUserId ?? null,
    })
    .select('id, name, filters, created_at')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(data)
})

// ── DELETE /api/smart-lists/:id ──────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { id } = req.params

  const { data: existing } = await supabase
    .from('smart_lists')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (!existing) {
    res.status(404).json({ error: 'Smart list not found' })
    return
  }

  const { error } = await supabase.from('smart_lists').delete().eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ deleted: true })
})

export default router
