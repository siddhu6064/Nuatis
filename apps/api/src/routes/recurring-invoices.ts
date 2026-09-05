import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()
router.use(requireAuth)

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

// ── GET /api/recurring-invoices ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_invoices')
    .select('*, contacts(full_name, email)')
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/recurring-invoices ────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const contactId = typeof b['contact_id'] === 'string' ? b['contact_id'] : ''
  if (!contactId) {
    res.status(400).json({ error: 'contact_id is required' })
    return
  }

  const description = typeof b['description'] === 'string' ? b['description'].trim() : ''
  if (!description) {
    res.status(400).json({ error: 'description is required' })
    return
  }

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

  const dueDays = typeof b['due_days'] === 'number' && b['due_days'] >= 0 ? b['due_days'] : 0
  const taxRate = typeof b['tax_rate'] === 'number' && b['tax_rate'] >= 0 ? b['tax_rate'] : 0

  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  const { data, error } = await supabase
    .from('recurring_invoices')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: contactId,
      deal_id: (b['deal_id'] as string) || null,
      description,
      amount,
      tax_rate: taxRate,
      due_days: dueDays,
      frequency,
      day_of_week: (b['day_of_week'] as number) ?? null,
      day_of_month: (b['day_of_month'] as number) ?? null,
      month_of_year: (b['month_of_year'] as number) ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create recurring invoice' })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/recurring-invoices/:id ─────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['description'] === 'string' && b['description'].trim())
    updates['description'] = b['description'].trim()
  if (typeof b['amount'] === 'number' && b['amount'] > 0) updates['amount'] = b['amount']
  if (typeof b['tax_rate'] === 'number' && b['tax_rate'] >= 0) updates['tax_rate'] = b['tax_rate']
  if (typeof b['due_days'] === 'number' && b['due_days'] >= 0) updates['due_days'] = b['due_days']
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
    .from('recurring_invoices')
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

// ── DELETE /api/recurring-invoices/:id (soft) ───────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_invoices')
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
