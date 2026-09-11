import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { broadcastToLocation } from '../../lib/pos-ws.js'
import { serviceDateFor } from '../../lib/pos-service-date.js'
import { requirePos } from './menu.js'

const router = Router()

const TICKET_STATUSES = ['queued', 'in_progress', 'ready', 'bumped'] as const
type TicketStatus = (typeof TICKET_STATUSES)[number]

interface LineRow {
  id: string
  menu_item_id: string | null
  description: string
  quantity: number
  modifiers: unknown
  notes: string | null
}

interface TicketRow {
  id: string
  location_id: string
  ticket_number: number
  service_date: string
  station: string | null
}

// ── POST /api/pos/tickets/fire ──────────────────────────────────────────────
// Fires an order to the kitchen, one ticket per distinct station. Line text and
// modifiers are snapshotted onto the ticket items so a later menu edit cannot
// rewrite what the kitchen was told to cook.
router.post(
  '/fire',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const orderId = typeof body['order_id'] === 'string' ? body['order_id'] : ''
    if (!orderId) {
      res.status(400).json({ error: 'order_id is required' })
      return
    }

    const supabase = getServiceClient()

    const { data: order } = await supabase
      .from('orders')
      .select('id, tenant_id, location_id')
      .eq('id', orderId)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ id: string; tenant_id: string; location_id: string | null }>()

    if (!order) {
      res.status(404).json({ error: 'Order not found' })
      return
    }
    const locationId = order.location_id
    if (!locationId) {
      // A ticket with no location cannot be routed to a kitchen screen without
      // risking delivery to another location's display.
      res.status(400).json({ error: 'Order has no location_id; cannot route to a kitchen' })
      return
    }

    const { data: lines } = await supabase
      .from('order_line_items')
      .select('id, menu_item_id, description, quantity, modifiers, notes')
      .eq('order_id', orderId)
      .eq('tenant_id', authed.tenantId)

    const lineRows = (lines ?? []) as LineRow[]
    if (lineRows.length === 0) {
      res.status(400).json({ error: 'Order has no line items to fire' })
      return
    }

    // Station lookup is tenant-scoped: a line pointing at a foreign menu item
    // must not inherit that tenant's station routing.
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('id, kitchen_station')
      .eq('tenant_id', authed.tenantId)

    const stationByMenuItem = new Map<string, string | null>()
    for (const mi of (menuItems ?? []) as { id: string; kitchen_station: string | null }[]) {
      stationByMenuItem.set(mi.id, mi.kitchen_station)
    }

    // Group lines by station. A line whose item has no station — or no menu
    // item at all — lands on the unrouted ticket, keyed by empty string.
    const linesByStation = new Map<string, LineRow[]>()
    for (const line of lineRows) {
      const station = (line.menu_item_id ? stationByMenuItem.get(line.menu_item_id) : null) ?? ''
      const list = linesByStation.get(station) ?? []
      list.push(line)
      linesByStation.set(station, list)
    }

    // The business day in the TENANT's timezone — see lib/pos-service-date.ts
    // for why this is not derived from UTC.
    const { data: tenant } = await supabase
      .from('tenants')
      .select('timezone')
      .eq('id', authed.tenantId)
      .maybeSingle<{ timezone: string | null }>()
    const serviceDate = serviceDateFor(tenant?.timezone ?? 'America/Chicago')

    // Ticket numbers restart per location per service day. This read-then-
    // insert is racy across two registers; the unique index added in 0196 is
    // the real guard, and this only picks the next number.
    const { data: sameDayTickets } = await supabase
      .from('kitchen_tickets')
      .select('ticket_number, location_id, service_date')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', locationId)
      .eq('service_date', serviceDate)

    let nextNumber =
      ((sameDayTickets ?? []) as { ticket_number: number }[]).reduce(
        (max, t) => Math.max(max, t.ticket_number),
        0
      ) + 1

    const created: unknown[] = []

    for (const [station, stationLines] of linesByStation) {
      const { data: ticket, error: ticketError } = await supabase
        .from('kitchen_tickets')
        .insert({
          tenant_id: authed.tenantId,
          location_id: locationId,
          order_id: order.id,
          station: station || null,
          status: 'queued',
          ticket_number: nextNumber,
          service_date: serviceDate,
        })
        .select()
        .single<TicketRow>()

      if (ticketError || !ticket) {
        res.status(500).json({ error: 'Failed to create kitchen ticket' })
        return
      }
      nextNumber += 1

      const itemRows = stationLines.map((line, index) => ({
        tenant_id: authed.tenantId,
        ticket_id: ticket.id,
        order_line_item_id: line.id,
        name: line.description,
        quantity: line.quantity,
        modifiers: line.modifiers ?? [],
        notes: line.notes,
        status: 'queued',
        sort_order: index,
      }))

      const { error: itemsError } = await supabase.from('kitchen_ticket_items').insert(itemRows)
      if (itemsError) {
        res.status(500).json({ error: 'Failed to create kitchen ticket items' })
        return
      }

      const payload = { ...ticket, station: station || null, items: itemRows }
      created.push(payload)
      broadcastToLocation(authed.tenantId, locationId, {
        type: 'ticket.fired',
        ticket: payload,
      })
    }

    res.status(201).json({ tickets: created })
  }
)

// ── GET /api/pos/tickets?location_id=&status= ───────────────────────────────
// location_id is required, not optional: without it a KDS request would span
// every location in the tenant.
router.get('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''
  if (!locationId) {
    res.status(400).json({ error: 'location_id is required' })
    return
  }

  const supabase = getServiceClient()
  let query = supabase
    .from('kitchen_tickets')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('location_id', locationId)

  const status = req.query['status']
  if (typeof status === 'string' && (TICKET_STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: 'Failed to load tickets' })
    return
  }

  const tickets = (data ?? []) as { id: string }[]
  const ticketIds = new Set(tickets.map((t) => t.id))

  const { data: items } = await supabase
    .from('kitchen_ticket_items')
    .select('*')
    .eq('tenant_id', authed.tenantId)

  const itemsByTicket = new Map<string, unknown[]>()
  for (const item of (items ?? []) as { ticket_id: string }[]) {
    if (!ticketIds.has(item.ticket_id)) continue
    const list = itemsByTicket.get(item.ticket_id) ?? []
    list.push(item)
    itemsByTicket.set(item.ticket_id, list)
  }

  res.json({
    tickets: tickets.map((t) => ({ ...t, items: itemsByTicket.get(t.id) ?? [] })),
  })
})

// ── PATCH /api/pos/tickets/:id/status ───────────────────────────────────────
router.patch(
  '/:id/status',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const status = (req.body as Record<string, unknown>)['status']
    if (typeof status !== 'string' || !(TICKET_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({
        error: `status must be one of: ${TICKET_STATUSES.join(', ')}`,
      })
      return
    }
    const nextStatus = status as TicketStatus

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'in_progress') patch['started_at'] = now
    if (nextStatus === 'ready') patch['ready_at'] = now
    if (nextStatus === 'bumped') {
      patch['bumped_at'] = now
      patch['bumped_by'] = authed.appUserId
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('kitchen_tickets')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select()
      .single<TicketRow>()

    if (error || !data) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    broadcastToLocation(authed.tenantId, data.location_id, {
      type: nextStatus === 'bumped' ? 'ticket.bumped' : 'ticket.updated',
      ticket: data,
    })

    res.json({ ticket: data })
  }
)

export default router
