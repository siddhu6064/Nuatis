import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'
import { resolvePromoCode } from '../lib/promo-code.js'

const router = Router()
router.use(requireAuth, requirePlan('cpq'))

// ── GET /api/promo-codes/lookup/:code ───────────────────────────────────────
// Validates a code without redeeming it — lets the quote builder preview the
// discount before the quote is actually created/saved.
router.get('/lookup/:code', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const code = req.params['code'] ?? ''

  const result = await resolvePromoCode(supabase, authed.tenantId, code)
  if (!result.ok) {
    res.status(404).json({ error: result.error })
    return
  }

  res.json(result.promoCode)
})

// ── GET /api/promo-codes ────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/promo-codes ───────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const code = typeof b['code'] === 'string' ? b['code'].trim().toUpperCase() : ''
  const discountType =
    b['discount_type'] === 'fixed' ? 'fixed' : b['discount_type'] === 'percent' ? 'percent' : null
  const discountValue = typeof b['discount_value'] === 'number' ? b['discount_value'] : 0

  if (!code) {
    res.status(400).json({ error: 'code is required' })
    return
  }
  if (!discountType) {
    res.status(400).json({ error: "discount_type must be 'percent' or 'fixed'" })
    return
  }
  if (discountValue <= 0) {
    res.status(400).json({ error: 'discount_value must be greater than 0' })
    return
  }
  if (discountType === 'percent' && discountValue > 100) {
    res.status(400).json({ error: 'discount_value cannot exceed 100 for a percent code' })
    return
  }

  const maxRedemptions =
    typeof b['max_redemptions'] === 'number' && b['max_redemptions'] > 0
      ? Math.round(b['max_redemptions'])
      : null
  const validUntil = typeof b['valid_until'] === 'string' ? b['valid_until'] : null

  const { data, error } = await supabase
    .from('promo_codes')
    .insert({
      tenant_id: authed.tenantId,
      code,
      discount_type: discountType,
      discount_value: discountValue,
      max_redemptions: maxRedemptions,
      redemption_count: 0,
      valid_until: validUntil,
      active: true,
      created_by: authed.userId,
    })
    .select('*')
    .single()

  if (error) {
    const status = error.code === '23505' ? 409 : 500
    res.status(status).json({
      error: error.code === '23505' ? 'A code with that name already exists' : error.message,
    })
    return
  }

  res.status(201).json(data)
})

// ── PATCH /api/promo-codes/:id ──────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['active'] === 'boolean') updates['active'] = b['active']
  if (typeof b['valid_until'] === 'string' || b['valid_until'] === null) {
    updates['valid_until'] = b['valid_until']
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('promo_codes')
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
