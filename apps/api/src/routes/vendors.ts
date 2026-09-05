import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'

const router = Router()

async function requireCrm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'crm')
  if (!enabled) {
    res.status(403).json({ error: 'CRM module is not enabled' })
    return
  }
  next()
}

// ── GET /api/vendors ─────────────────────────────────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const activeParam = typeof req.query['active'] === 'string' ? req.query['active'] : 'true'
  const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : ''

  let query = supabase.from('vendors').select('*').eq('tenant_id', authed.tenantId)
  if (activeParam !== 'all') query = query.eq('is_active', activeParam !== 'false')
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`)
  query = query.order('name', { ascending: true })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── POST /api/vendors ────────────────────────────────────────────────────────
router.post('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      tenant_id: authed.tenantId,
      name,
      contact_name: typeof b['contact_name'] === 'string' ? b['contact_name'].trim() || null : null,
      email: typeof b['email'] === 'string' ? b['email'].trim() || null : null,
      phone: typeof b['phone'] === 'string' ? b['phone'].trim() || null : null,
      address: typeof b['address'] === 'string' ? b['address'].trim() || null : null,
      notes: typeof b['notes'] === 'string' ? b['notes'] : null,
      is_active: true,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// ── GET /api/vendors/:id ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json(data)
})

// ── PUT /api/vendors/:id ─────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string') {
    const trimmed = b['name'].trim()
    if (!trimmed) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    updates['name'] = trimmed
  }
  for (const field of ['contact_name', 'email', 'phone', 'address'] as const) {
    if (typeof b[field] === 'string') updates[field] = b[field].trim() || null
    if (b[field] === null) updates[field] = null
  }
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null
  if (typeof b['is_active'] === 'boolean') updates['is_active'] = b['is_active']

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('vendors')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json(data)
})

// ── DELETE /api/vendors/:id (soft — flips is_active=false) ───────────────────
router.delete(
  '/:id',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('vendors')
      .update({ is_active: false })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('id')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({ success: true })
  }
)

export default router
