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
  canTransition,
  generatePlatformReference,
  requiresPostmortem,
  type PlatformSeverity,
  type PlatformStatus,
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

const IMPACTS = ['full', 'partial', 'none'] as const

// ── PUT /api/admin-console/incidents/:id/tenants ─────────────────────────────
// Replaces the whole set. Attaching is how a support conversation later answers
// "was this tenant affected by anything last month", so it has to be editable
// as the blast radius becomes clear — including shrinking.
router.put('/:id/tenants', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const body = req.body as { tenants?: { tenant_id?: unknown; impact?: unknown }[] }
  const incoming = Array.isArray(body.tenants) ? body.tenants : []

  // Everything is validated BEFORE the delete below. Validating as we go would
  // mean a single typo wipes the existing impact list and then returns an
  // error, losing work someone already did.
  const rows: { incident_id: string; tenant_id: string; impact: string }[] = []
  for (const entry of incoming) {
    const tenantId = typeof entry.tenant_id === 'string' ? entry.tenant_id : ''
    const impact = typeof entry.impact === 'string' ? entry.impact : 'partial'
    if (!tenantId) {
      res.status(400).json({ error: 'Each entry needs a tenant_id' })
      return
    }
    if (!(IMPACTS as readonly string[]).includes(impact)) {
      res.status(400).json({ error: `impact must be one of: ${IMPACTS.join(', ')}` })
      return
    }
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle<{ id: string }>()
    if (!tenant) {
      res.status(400).json({ error: `Unknown tenant: ${tenantId}` })
      return
    }
    rows.push({ incident_id: req.params['id'] as string, tenant_id: tenantId, impact })
  }

  await supabase.from('platform_incident_tenants').delete().eq('incident_id', req.params['id'])
  if (rows.length > 0) {
    const { error } = await supabase.from('platform_incident_tenants').insert(rows)
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
  }

  res.json({ tenants: rows })
})

// ── GET /api/admin-console/incidents/:id/tenants ─────────────────────────────
router.get('/:id/tenants', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('platform_incident_tenants')
    .select('tenant_id, impact')
    .eq('incident_id', req.params['id'])
  res.json({ tenants: data ?? [] })
})

// ── PATCH /api/admin-console/incidents/:id ───────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const { data: current } = await supabase
    .from('platform_incidents')
    .select('id, status, severity, postmortem')
    .eq('id', req.params['id'])
    .maybeSingle<{
      id: string
      status: PlatformStatus
      severity: PlatformSeverity
      postmortem: string | null
    }>()

  if (!current) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }

  const patch: Record<string, unknown> = {}
  const events: { kind: string; detail: Record<string, unknown> }[] = []

  if (typeof body['assigned_to_user_id'] === 'string') {
    const assignee = body['assigned_to_user_id']
    // users.id is a plain FK with no tenant in it, so nothing in the schema
    // stops an incident being handed to a merchant's account — where it would
    // read as owned by someone who can never see it.
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', assignee)
      .eq('tenant_id', process.env['PLATFORM_TENANT_ID'] ?? '')
      .maybeSingle<{ id: string }>()

    if (!user) {
      res.status(400).json({ error: 'Assignee is not a platform user' })
      return
    }
    patch['assigned_to_user_id'] = assignee
    events.push({ kind: 'assigned', detail: { assigned_to_user_id: assignee } })
  }

  if (typeof body['postmortem'] === 'string') {
    patch['postmortem'] = body['postmortem']
    events.push({ kind: 'postmortem_written', detail: {} })
  }

  if (typeof body['status'] === 'string') {
    const next = body['status'] as PlatformStatus
    if (!(PLATFORM_STATUSES as readonly string[]).includes(next)) {
      res.status(400).json({ error: `status must be one of: ${PLATFORM_STATUSES.join(', ')}` })
      return
    }
    if (!canTransition(current.status, next, current.severity)) {
      const owesPostmortem =
        current.status === 'resolved' && next === 'closed' && requiresPostmortem(current.severity)
      res.status(400).json({
        error: owesPostmortem
          ? `A ${current.severity.toUpperCase()} needs a postmortem before it can be closed`
          : `Cannot move an incident from ${current.status} to ${next}`,
      })
      return
    }

    // postmortem_due -> closed is legal in the map, but only once something is
    // actually written. Otherwise the gate becomes a box to tick.
    const writtenNow = typeof body['postmortem'] === 'string' ? body['postmortem'].trim() : ''
    const alreadyWritten = (current.postmortem ?? '').trim()
    if (
      next === 'closed' &&
      requiresPostmortem(current.severity) &&
      !writtenNow &&
      !alreadyWritten
    ) {
      res.status(400).json({ error: 'Write the postmortem before closing this incident' })
      return
    }

    patch['status'] = next
    const at = new Date().toISOString()
    if (next === 'acknowledged') {
      patch['acknowledged_at'] = at
      patch['acknowledged_by'] = authed.appUserId
    }
    if (next === 'mitigating') patch['mitigated_at'] = at
    if (next === 'resolved') patch['resolved_at'] = at
    if (next === 'postmortem_due') {
      // Five days. Without this the column is decorative — it exists in the
      // schema and nothing ever writes it, which is how a deadline quietly
      // stops being a deadline.
      patch['postmortem_due_at'] = new Date(Date.now() + 5 * 86_400_000).toISOString()
    }
    events.push({ kind: 'status_changed', detail: { from: current.status, to: next } })
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }
  patch['updated_at'] = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('platform_incidents')
    .update(patch)
    .eq('id', req.params['id'])
    .select('*')
    .single()

  if (error || !updated) {
    res.status(500).json({ error: error?.message ?? 'Failed to update incident' })
    return
  }

  for (const e of events) {
    await supabase.from('platform_incident_events').insert({
      incident_id: current.id,
      actor_kind: 'user',
      actor_user_id: authed.appUserId,
      kind: e.kind,
      detail: e.detail,
    })
  }

  res.json({ incident: updated })
})

export default router
