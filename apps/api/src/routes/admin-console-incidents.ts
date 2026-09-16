import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlatformOwner } from '../lib/platform-auth.js'
import { whoIsOnCallAt } from '../lib/oncall.js'
import { notifyPlatformTeam } from '../lib/notify-platform-team.js'
import {
  PLATFORM_SEVERITIES,
  PLATFORM_STATUSES,
  ackDueAt,
  generatePlatformReference,
  type PlatformSeverity,
} from '../lib/platform-incidents.js'

const router = Router()
router.use(requireAuth, requirePlatformOwner)

/** Mirrors the CHECK constraint on platform_incidents.component. */
const COMPONENTS = ['api', 'pos-socket', 'database', 'worker', 'web'] as const

// ── POST /api/admin-console/incidents ────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const severity = String(body['severity'] ?? '')
  if (!(PLATFORM_SEVERITIES as readonly string[]).includes(severity)) {
    res.status(400).json({ error: `severity must be one of: ${PLATFORM_SEVERITIES.join(', ')}` })
    return
  }
  const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  const component = typeof body['component'] === 'string' ? body['component'] : null
  // The column carries a CHECK constraint. Catching it here turns a 500 into a
  // message someone can act on.
  if (component !== null && !(COMPONENTS as readonly string[]).includes(component)) {
    res.status(400).json({ error: `component must be one of: ${COMPONENTS.join(', ')}` })
    return
  }

  const now = new Date()
  const reference = await generatePlatformReference(now)
  // The rota answers who should pick this up; the column records who owned it.
  const onCall = await whoIsOnCallAt(now)
  const due = ackDueAt(severity as PlatformSeverity, now)

  const { data: incident, error } = await supabase
    .from('platform_incidents')
    .insert({
      reference,
      severity,
      status: 'detected',
      title,
      summary: typeof body['summary'] === 'string' ? body['summary'] : null,
      component,
      assigned_to_user_id: onCall,
      detected_at: now.toISOString(),
      ack_due_at: due ? due.toISOString() : null,
    })
    .select('*')
    .single<{ id: string }>()

  if (error || !incident) {
    res.status(500).json({ error: error?.message ?? 'Failed to declare incident' })
    return
  }

  await supabase.from('platform_incident_events').insert({
    incident_id: incident.id,
    actor_kind: 'user',
    actor_user_id: authed.appUserId,
    kind: 'detected',
    detail: { severity, component, assigned_to_user_id: onCall },
  })

  // Fire-and-forget, and deliberately notifyPlatformTeam rather than
  // notifyOwner: the latter targets a merchant's tenant and would tell every
  // customer about an internal outage.
  void notifyPlatformTeam('platform_incident_declared', {
    title: `${severity.toUpperCase()} declared — ${reference}`,
    body: title,
    url: `/admin-console/incidents/${incident.id}`,
  })

  res.status(201).json({ incident })
})

// ── GET /api/admin-console/incidents ─────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from = (page - 1) * limit

  let query = supabase.from('platform_incidents').select('*', { count: 'exact' })

  const status = req.query['status']
  if (typeof status === 'string' && (PLATFORM_STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status)
  }
  const severity = req.query['severity']
  if (
    typeof severity === 'string' &&
    (PLATFORM_SEVERITIES as readonly string[]).includes(severity)
  ) {
    query = query.eq('severity', severity)
  }

  const { data, error, count } = await query
    .order('detected_at', { ascending: false })
    .range(from, from + limit - 1)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [], total: count ?? 0, page })
})

// ── GET /api/admin-console/incidents/:id ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data: incident } = await supabase
    .from('platform_incidents')
    .select('*')
    .eq('id', req.params['id'])
    .maybeSingle()

  if (!incident) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }

  const { data: events } = await supabase
    .from('platform_incident_events')
    .select('*')
    .eq('incident_id', req.params['id'])

  const timeline = ((events ?? []) as { at: string }[]).sort((a, b) => a.at.localeCompare(b.at))
  res.json({ incident, events: timeline })
})

export default router
