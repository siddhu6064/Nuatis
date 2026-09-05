import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'

const router = Router()

async function requireScheduling(req: Request, res: Response, next: () => void): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'scheduling')
  if (!enabled) {
    res.status(403).json({ error: 'Scheduling module is not enabled' })
    return
  }
  next()
}
router.use(requireAuth, requireScheduling)

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const
type Frequency = (typeof FREQUENCIES)[number]

const TIME_RE = /^\d{2}:\d{2}$/

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

// ── GET /api/recurring-appointments ──────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_appointment_rules')
    .select('*, contacts(full_name)')
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/recurring-appointments ─────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const contactId = typeof b['contact_id'] === 'string' ? b['contact_id'] : ''
  const title = typeof b['title'] === 'string' ? b['title'].trim() : ''
  if (!contactId) {
    res.status(400).json({ error: 'contact_id is required' })
    return
  }
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const durationMinutes = b['duration_minutes']
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) {
    res.status(400).json({ error: 'duration_minutes must be a number > 0' })
    return
  }

  const startTime = typeof b['start_time'] === 'string' ? b['start_time'] : ''
  if (!TIME_RE.test(startTime)) {
    res.status(400).json({ error: 'start_time must be HH:MM' })
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
    .from('recurring_appointment_rules')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: contactId,
      title,
      description: typeof b['description'] === 'string' ? b['description'] : null,
      location_id: typeof b['location_id'] === 'string' ? b['location_id'] : null,
      assigned_staff_id: typeof b['assigned_staff_id'] === 'string' ? b['assigned_staff_id'] : null,
      duration_minutes: durationMinutes,
      frequency,
      day_of_week: typeof b['day_of_week'] === 'number' ? b['day_of_week'] : null,
      day_of_month: typeof b['day_of_month'] === 'number' ? b['day_of_month'] : null,
      start_time: startTime,
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

// ── PUT /api/recurring-appointments/:id ──────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['title'] === 'string' && b['title'].trim()) updates['title'] = b['title'].trim()
  if (typeof b['description'] === 'string') updates['description'] = b['description']
  if (typeof b['enabled'] === 'boolean') updates['enabled'] = b['enabled']
  if (typeof b['assigned_staff_id'] === 'string')
    updates['assigned_staff_id'] = b['assigned_staff_id']
  if (b['assigned_staff_id'] === null) updates['assigned_staff_id'] = null

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('recurring_appointment_rules')
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

// ── DELETE /api/recurring-appointments/:id (soft) ────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('recurring_appointment_rules')
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
