import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()
router.use(requireAuth)

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const
type Frequency = (typeof FREQUENCIES)[number]

function validateSchedule(
  frequency: Frequency,
  dayOfWeek: unknown,
  dayOfMonth: unknown
): string | null {
  if (frequency === 'weekly' || frequency === 'biweekly') {
    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6) {
      return 'day_of_week (0-6) is required for a weekly/biweekly rule'
    }
  }
  if (frequency === 'monthly') {
    if (typeof dayOfMonth !== 'number' || dayOfMonth < 1 || dayOfMonth > 31) {
      return 'day_of_month (1-31) is required for a monthly rule'
    }
  }
  return null
}

// ── GET /api/recurring-tasks ──────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_task_rules')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/recurring-tasks ──────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const title = typeof b['title'] === 'string' ? b['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const priority = typeof b['priority'] === 'string' ? b['priority'] : 'medium'
  if (!['low', 'medium', 'high'].includes(priority)) {
    res.status(400).json({ error: 'priority must be low, medium, or high' })
    return
  }

  const frequency = b['frequency'] as string
  if (!FREQUENCIES.includes(frequency as Frequency)) {
    res.status(400).json({ error: `frequency must be one of ${FREQUENCIES.join(', ')}` })
    return
  }

  const scheduleErr = validateSchedule(frequency as Frequency, b['day_of_week'], b['day_of_month'])
  if (scheduleErr) {
    res.status(400).json({ error: scheduleErr })
    return
  }

  const { data, error } = await supabase
    .from('recurring_task_rules')
    .insert({
      tenant_id: authed.tenantId,
      title,
      contact_id: typeof b['contact_id'] === 'string' ? b['contact_id'] : null,
      assigned_to_user_id:
        typeof b['assigned_to_user_id'] === 'string' ? b['assigned_to_user_id'] : null,
      priority,
      frequency,
      day_of_week: typeof b['day_of_week'] === 'number' ? b['day_of_week'] : null,
      day_of_month: typeof b['day_of_month'] === 'number' ? b['day_of_month'] : null,
      enabled: true,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/recurring-tasks/:id ───────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['enabled'] === 'boolean') updates['enabled'] = b['enabled']
  if (typeof b['title'] === 'string' && b['title'].trim()) updates['title'] = b['title'].trim()

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('recurring_task_rules')
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

// ── DELETE /api/recurring-tasks/:id (soft) ─────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_task_rules')
    .update({ deleted_at: new Date().toISOString(), enabled: false })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('id')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({ success: true })
})

export default router
