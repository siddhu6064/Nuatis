import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { verifyPin } from '../../lib/pos-pin.js'
import {
  requiresAuthorisation,
  slaDueAt,
  generateIncidentReference,
  DEFAULT_AUTH_THRESHOLD_CENTS,
  SEVERITIES,
  type Severity,
} from '../../lib/incidents.js'
import { seedIncidentTypes } from '../../lib/incident-types.js'
import { requirePos } from './menu.js'

const router = Router()

interface StaffRow {
  id: string
  tenant_id: string
  is_active: boolean
  pos_can_authorise: boolean
  pos_pin_hash: string | null
}

/**
 * Report an incident from the register or the kitchen display.
 *
 * Deliberately gated on `pos`, not on `incidents`: logging a comp is part of
 * running a till, and a pos_only merchant must be able to do it. The tracker —
 * queue, assignment, SLA views — is what the incidents module sells.
 *
 * This route lives under /api/pos/* because a register token carries
 * portalScope 'pos', which requireAuth confines to that prefix. Moving it to
 * /api/incidents would make it unreachable from the register.
 */
router.post('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const supabase = getServiceClient()

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

  // The type must be the tenant's own. Service-role bypasses RLS, so this is
  // the boundary, not the policy.
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

  // A type flagged requires_cost must carry one. Wastage with a zero cost is
  // almost always someone tapping through the keypad, and it silently
  // understates the month's food cost.
  if (type.requires_cost && costCents <= 0) {
    res.status(400).json({ error: 'This incident type needs an amount' })
    return
  }

  // Every foreign key from the body is proven tenant-owned before it is stored.
  const orderId = typeof body['order_id'] === 'string' ? body['order_id'] : null
  if (orderId && !(await ownsRow(supabase, 'orders', orderId, authed.tenantId))) {
    res.status(400).json({ error: 'Order not found' })
    return
  }
  const ticketId = typeof body['kitchen_ticket_id'] === 'string' ? body['kitchen_ticket_id'] : null
  if (ticketId && !(await ownsRow(supabase, 'kitchen_tickets', ticketId, authed.tenantId))) {
    res.status(400).json({ error: 'Ticket not found' })
    return
  }
  const reporterId =
    typeof body['reported_by_staff_id'] === 'string' ? body['reported_by_staff_id'] : null
  if (reporterId && !(await ownsRow(supabase, 'staff_members', reporterId, authed.tenantId))) {
    res.status(400).json({ error: 'Staff member not found' })
    return
  }

  // Authorisation. The client also checks the threshold so it knows whether to
  // show the PIN pad, but THIS is the check that matters — a register is a
  // device in a public room and its request body is not trustworthy.
  const threshold = await authThresholdFor(authed.tenantId)
  let authorisedBy: string | null = null

  if (requiresAuthorisation(costCents, threshold)) {
    const pin = typeof body['manager_pin'] === 'string' ? body['manager_pin'] : ''
    authorisedBy = pin ? await resolveAuthoriser(supabase, authed.tenantId, pin) : null
    if (!authorisedBy) {
      // One message for a missing PIN, a wrong PIN, and a PIN belonging to
      // someone without the flag. Distinguishing them tells a cashier which
      // guess got closer.
      res.status(403).json({ error: 'A manager PIN is required for this amount' })
      return
    }
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
      location_id: typeof body['location_id'] === 'string' ? body['location_id'] : null,
      order_id: orderId,
      kitchen_ticket_id: ticketId,
      reported_by_staff_id: reporterId,
      authorised_by_staff_id: authorisedBy,
      sla_due_at: slaDueAt(severity, now).toISOString(),
    })
    .select('*')
    .single<{ id: string }>()

  if (error || !incident) {
    res.status(500).json({ error: error?.message ?? 'Failed to record incident' })
    return
  }

  await supabase.from('incident_events').insert({
    tenant_id: authed.tenantId,
    incident_id: incident.id,
    actor_kind: 'staff',
    actor_id: reporterId,
    kind: 'reported',
    detail: { cost_cents: costCents, authorised_by: authorisedBy },
  })

  res.status(201).json({ incident })
})

// ── GET /api/pos/incidents/types ────────────────────────────────────────────
router.get(
  '/types',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    // Seed on first read. A tenant with no types cannot report anything, and
    // seeding at signup would only help tenants created after this ships.
    // seedIncidentTypes is idempotent and returns immediately once types exist.
    const { data: tenant } = await supabase
      .from('tenants')
      .select('vertical')
      .eq('id', authed.tenantId)
      .maybeSingle<{ vertical: string | null }>()
    await seedIncidentTypes(authed.tenantId, tenant?.vertical ?? null)

    const { data } = await supabase
      .from('incident_types')
      .select('key, label, default_severity, requires_cost, sort_order')
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)

    const types = (data ?? []) as { sort_order: number }[]
    res.json({ types: [...types].sort((a, b) => a.sort_order - b.sort_order) })
  }
)

/** Per-tenant threshold, falling back to $10. */
async function authThresholdFor(tenantId: string): Promise<number> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('incident_auth_threshold_cents')
    .eq('id', tenantId)
    .maybeSingle<{ incident_auth_threshold_cents: number | null }>()
  const v = data?.incident_auth_threshold_cents
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_AUTH_THRESHOLD_CENTS
}

/**
 * The staff id of an authoriser whose PIN matches, or null.
 *
 * Authorisation is the explicit `pos_can_authorise` flag, NOT a role string:
 * staff_members.role is free-text job titles — "Head Chef", "Front of House",
 * "Cashier" — so matching role = 'manager' would match nothing in production
 * and refuse every comp forever.
 *
 * Compares against every candidate even after a match, the same way
 * routes/pos/terminal-auth.ts does, so response time does not reveal how many
 * authorisers a tenant has or where a matching PIN sits in the list.
 */
async function resolveAuthoriser(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  pin: string
): Promise<string | null> {
  const { data } = await supabase
    .from('staff_members')
    .select('id, tenant_id, is_active, pos_can_authorise, pos_pin_hash')
    .eq('tenant_id', tenantId)

  const candidates = ((data ?? []) as StaffRow[]).filter(
    (s) => s.tenant_id === tenantId && s.is_active && s.pos_can_authorise && s.pos_pin_hash
  )

  let matched: StaffRow | null = null
  for (const candidate of candidates) {
    const ok = await verifyPin(pin, candidate.pos_pin_hash as string)
    if (ok && !matched) matched = candidate
  }
  return matched?.id ?? null
}

/**
 * Confirm a row belongs to the caller's tenant. Same guard as
 * routes/pos/menu.ts — the service-role client bypasses RLS, so this is the
 * live boundary for every foreign key that arrives in a request body.
 */
async function ownsRow(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  id: string,
  tenantId: string
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string }>()
  return !!data
}

export default router
