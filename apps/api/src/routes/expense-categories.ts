import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'
import { ensureDefaultCategories } from '../lib/expense-categories.js'

const router = Router()
router.use(requireAuth, requirePlan('expenses'))

// ── GET /api/expense-categories ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const includeArchived = req.query['include_archived'] === 'true'

  const categories = await ensureDefaultCategories(authed.tenantId)
  const filtered = includeArchived ? categories : categories.filter((c) => !c.is_archived)

  res.json({ data: filtered })
})

// ── POST /api/expense-categories ────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const { data, error } = await supabase
    .from('expense_categories')
    .insert({ tenant_id: authed.tenantId, name })
    .select('*')
    .single()

  if (error) {
    const status = error.code === '23505' ? 409 : 500
    res.status(status).json({ error: error.message })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/expense-categories/:id ─────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string' && b['name'].trim()) updates['name'] = b['name'].trim()
  if (typeof b['is_archived'] === 'boolean') updates['is_archived'] = b['is_archived']

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('expense_categories')
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

export default router
