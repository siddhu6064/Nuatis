import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'

const router = Router()
router.use(requireAuth, requirePlan('expenses'))

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'annually'] as const
type Frequency = (typeof FREQUENCIES)[number]

function validateSchedule(
  frequency: Frequency,
  dayOfWeek: unknown,
  dayOfMonth: unknown,
  monthOfYear: unknown
): string | null {
  if (frequency === 'weekly') {
    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6) {
      return 'day_of_week (0-6) is required for a weekly rule'
    }
  }
  if (frequency === 'monthly' || frequency === 'quarterly') {
    if (typeof dayOfMonth !== 'number' || dayOfMonth < 1 || dayOfMonth > 31) {
      return 'day_of_month (1-31) is required for a monthly/quarterly rule'
    }
  }
  if (frequency === 'annually') {
    if (typeof dayOfMonth !== 'number' || dayOfMonth < 1 || dayOfMonth > 31) {
      return 'day_of_month (1-31) is required for an annual rule'
    }
    if (typeof monthOfYear !== 'number' || monthOfYear < 1 || monthOfYear > 12) {
      return 'month_of_year (1-12) is required for an annual rule'
    }
  }
  return null
}

// ── GET /api/recurring-expenses ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*, expense_categories(name)')
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/recurring-expenses ────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const amount = typeof b['amount'] === 'number' ? b['amount'] : NaN
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount must be a number > 0' })
    return
  }

  const frequency = b['frequency'] as string
  if (!FREQUENCIES.includes(frequency as Frequency)) {
    res.status(400).json({ error: `frequency must be one of ${FREQUENCIES.join(', ')}` })
    return
  }

  const scheduleErr = validateSchedule(
    frequency as Frequency,
    b['day_of_week'],
    b['day_of_month'],
    b['month_of_year']
  )
  if (scheduleErr) {
    res.status(400).json({ error: scheduleErr })
    return
  }

  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert({
      tenant_id: authed.tenantId,
      category_id: (b['category_id'] as string) || null,
      amount,
      vendor: typeof b['vendor'] === 'string' ? b['vendor'].trim() : null,
      notes: (b['notes'] as string) || null,
      frequency,
      day_of_week: (b['day_of_week'] as number) ?? null,
      day_of_month: (b['day_of_month'] as number) ?? null,
      month_of_year: (b['month_of_year'] as number) ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create recurring expense' })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/recurring-expenses/:id ─────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['category_id'] === 'string') updates['category_id'] = b['category_id']
  if (b['category_id'] === null) updates['category_id'] = null
  if (typeof b['amount'] === 'number' && b['amount'] > 0) updates['amount'] = b['amount']
  if (typeof b['vendor'] === 'string') updates['vendor'] = b['vendor'].trim()
  if (b['vendor'] === null) updates['vendor'] = null
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null
  if (typeof b['enabled'] === 'boolean') updates['enabled'] = b['enabled']

  if (b['frequency'] !== undefined) {
    const frequency = b['frequency'] as string
    if (!FREQUENCIES.includes(frequency as Frequency)) {
      res.status(400).json({ error: `frequency must be one of ${FREQUENCIES.join(', ')}` })
      return
    }
    const scheduleErr = validateSchedule(
      frequency as Frequency,
      b['day_of_week'],
      b['day_of_month'],
      b['month_of_year']
    )
    if (scheduleErr) {
      res.status(400).json({ error: scheduleErr })
      return
    }
    updates['frequency'] = frequency
    updates['day_of_week'] = (b['day_of_week'] as number) ?? null
    updates['day_of_month'] = (b['day_of_month'] as number) ?? null
    updates['month_of_year'] = (b['month_of_year'] as number) ?? null
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(data)
})

// ── DELETE /api/recurring-expenses/:id (soft) ───────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({ success: true })
})

export default router
