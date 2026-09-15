import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requireIncidents } from '../lib/incident-module.js'
import {
  canTransition,
  generateIncidentReference,
  slaDueAt,
  INCIDENT_STATUSES,
  SEVERITIES,
  type IncidentStatus,
  type Severity,
} from '../lib/incidents.js'

const router = Router()

interface IncidentRow {
  id: string
  status: IncidentStatus
  assigned_to_user_id: string | null
}

// ── GET /api/incidents ──────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const page = Math.max(1, Number(req.query['page']) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
    const from = (page - 1) * limit

    let query = supabase
      .from('incidents')
      .select('*', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)

    const status = req.query['status']
    if (typeof status === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(status)) {
      query = query.eq('status', status)
    }
    const severity = req.query['severity']
    if (typeof severity === 'string' && (SEVERITIES as readonly string[]).includes(severity)) {
      query = query.eq('severity', severity)
    }
    const typeKey = req.query['type_key']
    if (typeof typeKey === 'string' && typeKey !== '') query = query.eq('type_key', typeKey)
    const assignee = req.query['assigned_to_user_id']
    if (typeof assignee === 'string' && assignee !== '') {
      query = query.eq('assigned_to_user_id', assignee)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ data: data ?? [], total: count ?? 0, page })
  }
)

// ── GET /api/incidents/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: incident } = await supabase
      .from('incidents')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!incident) {
      res.status(404).json({ error: 'Incident not found' })
      return
    }

    const { data: events } = await supabase
      .from('incident_events')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('incident_id', req.params['id'])

    const timeline = ((events ?? []) as { at: string }[]).sort((a, b) => a.at.localeCompare(b.at))
    res.json({ incident, events: timeline })
  }
)

// ── POST /api/incidents ─────────────────────────────────────────────────────
// No manager-PIN path here. The threshold exists because the register is a
// shared device in a public room; a dashboard user is already authenticated as
// a named person, and their user id lands on the row.
router.post(
  '/',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const body = req.body as Record<string, unknown>

    const typeKey = typeof body['type_key'] === 'string' ? body['type_key'] : ''
    const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
    const costCents = typeof body['cost_cents'] === 'number' ? body['cost_cents'] : 0

    if (!typeKey || !title) {
      res.status(400).json({ error: 'type_key and title are required' })
      return
    }
    if (!Number.isInteger(costCents) || costCents < 0) {
      res.status(400).json({ error: 'cost_cents must be a non-negative integer' })
      return
    }

    const { data: type } = await supabase
      .from('incident_types')
      .select('key, default_severity, requires_cost')
      .eq('tenant_id', authed.tenantId)
      .eq('key', typeKey)
      .is('deleted_at', null)
      .maybeSingle<{ key: string; default_severity: Severity; requires_cost: boolean }>()

    if (!type) {
      res.status(400).json({ error: `Unknown incident type: ${typeKey}` })
      return
    }
    if (type.requires_cost && costCents <= 0) {
      res.status(400).json({ error: 'This incident type needs an amount' })
      return
    }

    const severity = (SEVERITIES as readonly string[]).includes(String(body['severity']))
      ? (body['severity'] as Severity)
      : type.default_severity

    const now = new Date()
    const reference = await generateIncidentReference(authed.tenantId)

    const { data: incident, error } = await supabase
      .from('incidents')
      .insert({
        tenant_id: authed.tenantId,
        reference,
        type_key: type.key,
        severity,
        status: 'open',
        title,
        description: typeof body['description'] === 'string' ? body['description'] : null,
        cost_cents: costCents,
        reported_by_user_id: authed.appUserId,
        sla_due_at: slaDueAt(severity, now).toISOString(),
      })
      .select('*')
      .single<{ id: string }>()

    if (error || !incident) {
      res.status(500).json({ error: error?.message ?? 'Failed to create incident' })
      return
    }

    await supabase.from('incident_events').insert({
      tenant_id: authed.tenantId,
      incident_id: incident.id,
      actor_kind: 'user',
      actor_id: authed.appUserId,
      kind: 'reported',
      detail: { cost_cents: costCents },
    })

    res.status(201).json({ incident })
  }
)

// ── PATCH /api/incidents/:id ────────────────────────────────────────────────
router.patch(
  '/:id',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const body = req.body as Record<string, unknown>

    const { data: current } = await supabase
      .from('incidents')
      .select('id, status, assigned_to_user_id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<IncidentRow>()

    if (!current) {
      res.status(404).json({ error: 'Incident not found' })
      return
    }

    const patch: Record<string, unknown> = {}
    const events: { kind: string; detail: Record<string, unknown> }[] = []

    // Assignment. The assignee must belong to this tenant — service-role
    // bypasses RLS, so this check is the boundary.
    if (typeof body['assigned_to_user_id'] === 'string') {
      const assignee = body['assigned_to_user_id']
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('id', assignee)
        .eq('tenant_id', authed.tenantId)
        .maybeSingle<{ id: string }>()

      if (!user) {
        res.status(400).json({ error: 'Assignee not found' })
        return
      }
      patch['assigned_to_user_id'] = assignee
      events.push({ kind: 'assigned', detail: { assigned_to_user_id: assignee } })
    }

    // Status. The transition map is the rule, and it refuses a no-op so an
    // event row is never written for a change that did not happen.
    if (typeof body['status'] === 'string') {
      const next = body['status'] as IncidentStatus
      if (!(INCIDENT_STATUSES as readonly string[]).includes(next)) {
        res.status(400).json({ error: `status must be one of: ${INCIDENT_STATUSES.join(', ')}` })
        return
      }
      if (!canTransition(current.status, next)) {
        res.status(400).json({ error: `Cannot move an incident from ${current.status} to ${next}` })
        return
      }
      patch['status'] = next
      if (next === 'resolved') patch['resolved_at'] = new Date().toISOString()
      events.push({ kind: 'status_changed', detail: { from: current.status, to: next } })
    }

    if (typeof body['root_cause'] === 'string') patch['root_cause'] = body['root_cause']
    if (typeof body['resolution_notes'] === 'string') {
      patch['resolution_notes'] = body['resolution_notes']
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' })
      return
    }

    patch['updated_at'] = new Date().toISOString()

    const { data: updated, error } = await supabase
      .from('incidents')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (error || !updated) {
      res.status(500).json({ error: error?.message ?? 'Failed to update incident' })
      return
    }

    for (const e of events) {
      await supabase.from('incident_events').insert({
        tenant_id: authed.tenantId,
        incident_id: current.id,
        actor_kind: 'user',
        actor_id: authed.appUserId,
        kind: e.kind,
        detail: e.detail,
      })
    }

    res.json({ incident: updated })
  }
)

export default router
