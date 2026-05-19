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

const DEFAULT_HOURS = {
  mon: { open: '09:00', close: '17:00', enabled: true },
  tue: { open: '09:00', close: '17:00', enabled: true },
  wed: { open: '09:00', close: '17:00', enabled: true },
  thu: { open: '09:00', close: '17:00', enabled: true },
  fri: { open: '09:00', close: '17:00', enabled: true },
  sat: { open: '09:00', close: '17:00', enabled: false },
  sun: { open: '09:00', close: '17:00', enabled: false },
}

router.use(requireAuth)

// ── GET /api/availability-schedules ──────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const [{ data: schedules }, { data: locs }] = await Promise.all([
    supabase
      .from('availability_schedules')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .order('name', { ascending: true }),
    supabase
      .from('locations')
      .select('id, availability_schedule_id')
      .eq('tenant_id', authed.tenantId),
  ])

  const scheduleList = (schedules ?? []).map((s) => ({
    ...s,
    applied_count: 0,
    applied_location_ids: [] as string[],
  }))

  for (const loc of locs ?? []) {
    const sid = loc.availability_schedule_id as string | null
    if (sid) {
      const found = scheduleList.find((s) => s.id === sid)
      if (found) {
        found.applied_count++
        found.applied_location_ids.push(loc.id as string)
      }
    }
  }

  res.json({ schedules: scheduleList })
})

// ── POST /api/availability-schedules ─────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const b = req.body as Record<string, unknown>
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  const timezone = typeof b['timezone'] === 'string' ? b['timezone'] : 'America/Chicago'
  const hours = b['hours'] && typeof b['hours'] === 'object' ? b['hours'] : DEFAULT_HOURS

  if (!name) {
    res.status(400).json({ error: 'name required' })
    return
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('availability_schedules')
    .insert({ tenant_id: authed.tenantId, name, timezone, hours })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({ schedule: { ...data, applied_count: 0, applied_location_ids: [] } })
})

// ── PATCH /api/availability-schedules/:id ────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b['name'] === 'string' && b['name'].trim()) updates['name'] = b['name'].trim()
  if (typeof b['timezone'] === 'string') updates['timezone'] = b['timezone']
  if (b['hours'] && typeof b['hours'] === 'object') updates['hours'] = b['hours']

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('availability_schedules')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({ schedule: data })
})

// ── DELETE /api/availability-schedules/:id ───────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { error } = await supabase
    .from('availability_schedules')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(204).send()
})

// ── POST /api/availability-schedules/:id/apply ───────────────────────────────
router.post('/:id/apply', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const b = req.body as Record<string, unknown>
  const calendarIds = Array.isArray(b['calendarIds'])
    ? (b['calendarIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : []

  const supabase = getSupabase()

  // Verify schedule belongs to tenant
  const { data: schedule } = await supabase
    .from('availability_schedules')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' })
    return
  }

  // Clear existing applications of this schedule
  await supabase
    .from('locations')
    .update({ availability_schedule_id: null })
    .eq('tenant_id', authed.tenantId)
    .eq('availability_schedule_id', id)

  // Apply to selected locations
  if (calendarIds.length > 0) {
    await supabase
      .from('locations')
      .update({ availability_schedule_id: id })
      .eq('tenant_id', authed.tenantId)
      .in('id', calendarIds)
  }

  res.json({ applied: calendarIds.length })
})

export default router
