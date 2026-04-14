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

// GET /api/services
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    res.status(500).json({ error: 'Failed to fetch services' })
    return
  }
  res.json({ services: data ?? [] })
})

// POST /api/services
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const { data, error } = await supabase
    .from('services')
    .insert({
      tenant_id: authed.tenantId,
      name,
      description: (b['description'] as string) || null,
      category: (b['category'] as string) || null,
      unit_price: typeof b['unit_price'] === 'number' ? b['unit_price'] : 0,
      unit: (b['unit'] as string) || 'each',
      duration_minutes: typeof b['duration_minutes'] === 'number' ? b['duration_minutes'] : null,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// PUT /api/services/:id
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (b['description'] !== undefined) updates['description'] = b['description'] || null
  if (b['category'] !== undefined) updates['category'] = b['category'] || null
  if (typeof b['unit_price'] === 'number') updates['unit_price'] = b['unit_price']
  if (typeof b['unit'] === 'string') updates['unit'] = b['unit']
  if (typeof b['duration_minutes'] === 'number') updates['duration_minutes'] = b['duration_minutes']

  const { data, error } = await supabase
    .from('services')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

// DELETE /api/services/:id (soft delete)
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('services')
    .update({ is_active: false })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

export default router
