import { Router, type Request, type Response } from 'express'
import { toCents, toDollars } from '@nuatis/pos-core'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { requirePos } from './menu.js'

const router = Router()

const CASH_EVENT_TYPES = ['sale', 'refund', 'paid_in', 'paid_out', 'drop'] as const
type CashEventType = (typeof CASH_EVENT_TYPES)[number]

/**
 * Direction of each event type on the drawer balance. Amounts are stored
 * unsigned and the direction lives here, so summing a drawer cannot
 * double-negate a refund.
 */
const EVENT_SIGN: Record<CashEventType, 1 | -1> = {
  sale: 1,
  paid_in: 1,
  refund: -1,
  paid_out: -1,
  drop: -1,
}

interface SessionRow {
  id: string
  location_id: string
  opening_float: string
  closed_at: string | null
}

// ── POST /api/pos/drawer/sessions ───────────────────────────────────────────
router.post(
  '/sessions',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
    if (!locationId) {
      res.status(400).json({ error: 'location_id is required' })
      return
    }
    const openingFloat = typeof body['opening_float'] === 'number' ? body['opening_float'] : 0
    if (openingFloat < 0) {
      res.status(400).json({ error: 'opening_float must not be negative' })
      return
    }

    const supabase = getServiceClient()

    // The partial unique index in 0197 is the authoritative guard; this check
    // exists to return a 409 rather than a raw constraint error.
    const { data: existing } = await supabase
      .from('cash_drawer_sessions')
      .select('id, closed_at')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', locationId)
    const open = ((existing ?? []) as { id: string; closed_at: string | null }[]).find(
      (s) => !s.closed_at
    )
    if (open) {
      res.status(409).json({ error: 'A drawer is already open at this location' })
      return
    }

    const { data, error } = await supabase
      .from('cash_drawer_sessions')
      .insert({
        tenant_id: authed.tenantId,
        location_id: locationId,
        opened_by: authed.appUserId,
        opening_float: openingFloat,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to open drawer session' })
      return
    }
    res.status(201).json({ session: data })
  }
)

// ── GET /api/pos/drawer/sessions/current?location_id= ───────────────────────
router.get(
  '/sessions/current',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''
    if (!locationId) {
      res.status(400).json({ error: 'location_id is required' })
      return
    }

    const supabase = getServiceClient()
    const { data } = await supabase
      .from('cash_drawer_sessions')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', locationId)

    const open = ((data ?? []) as { closed_at: string | null }[]).find((s) => !s.closed_at)
    res.json({ session: open ?? null })
  }
)

/** Load a session that belongs to the caller, or null. */
async function loadOwnSession(
  supabase: ReturnType<typeof getServiceClient>,
  sessionId: string,
  tenantId: string
): Promise<SessionRow | null> {
  const { data } = await supabase
    .from('cash_drawer_sessions')
    .select('id, location_id, opening_float, closed_at')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle<SessionRow>()
  return data ?? null
}

// ── POST /api/pos/drawer/sessions/:id/events ────────────────────────────────
router.post(
  '/sessions/:id/events',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const type = body['type']
    if (typeof type !== 'string' || !(CASH_EVENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `type must be one of: ${CASH_EVENT_TYPES.join(', ')}` })
      return
    }
    const amount = body['amount']
    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({
        error: 'amount must be a non-negative number; direction is carried by type',
      })
      return
    }

    const supabase = getServiceClient()
    const session = await loadOwnSession(supabase, req.params['id'] as string, authed.tenantId)
    if (!session) {
      res.status(404).json({ error: 'Drawer session not found' })
      return
    }
    if (session.closed_at) {
      res.status(409).json({ error: 'Drawer session is already closed' })
      return
    }

    const { data, error } = await supabase
      .from('cash_events')
      .insert({
        tenant_id: authed.tenantId,
        session_id: session.id,
        type,
        amount,
        order_id: typeof body['order_id'] === 'string' ? body['order_id'] : null,
        recorded_by: authed.appUserId,
        note: typeof body['note'] === 'string' ? body['note'] : null,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to record cash event' })
      return
    }
    res.status(201).json({ event: data })
  }
)

// ── POST /api/pos/drawer/sessions/:id/close ─────────────────────────────────
router.post(
  '/sessions/:id/close',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const countedTotal = body['counted_total']
    if (typeof countedTotal !== 'number') {
      res.status(400).json({ error: 'counted_total is required' })
      return
    }

    const supabase = getServiceClient()
    const session = await loadOwnSession(supabase, req.params['id'] as string, authed.tenantId)
    if (!session) {
      res.status(404).json({ error: 'Drawer session not found' })
      return
    }
    if (session.closed_at) {
      res.status(409).json({ error: 'Drawer session is already closed' })
      return
    }

    const { data: events } = await supabase
      .from('cash_events')
      .select('type, amount, session_id')
      .eq('tenant_id', authed.tenantId)
      .eq('session_id', session.id)

    // Integer cents throughout — a drawer reconciled with float arithmetic
    // produces phantom one-cent variances a cashier cannot explain.
    let expectedCents = toCents(session.opening_float)
    for (const e of (events ?? []) as { type: string; amount: string; session_id: string }[]) {
      if (e.session_id !== session.id) continue
      const sign = EVENT_SIGN[e.type as CashEventType]
      if (!sign) continue
      expectedCents += sign * toCents(e.amount)
    }

    const countedCents = toCents(countedTotal)
    const varianceCents = countedCents - expectedCents

    const { data, error } = await supabase
      .from('cash_drawer_sessions')
      .update({
        closed_at: new Date().toISOString(),
        closed_by: authed.appUserId,
        counted_total: toDollars(countedCents),
        expected_total: toDollars(expectedCents),
        variance: toDollars(varianceCents),
        notes: typeof body['notes'] === 'string' ? body['notes'] : null,
      })
      .eq('id', session.id)
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to close drawer session' })
      return
    }
    res.json({ session: data })
  }
)

export default router
