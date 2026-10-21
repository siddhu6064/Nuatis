import { Router, type Request, type Response } from 'express'
import { toCents, toDollars } from '@nuatis/pos-core'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { generateOrderNumber } from '../../lib/order-number.js'
import { requirePos } from './menu.js'

const router = Router()

const TENDER_METHODS = ['cash', 'card', 'gift_card'] as const
type TenderMethod = (typeof TENDER_METHODS)[number]

interface LineInput {
  menuItemId: string
  quantity: number
  optionIds: string[]
  notes: string | null
}

interface MenuItemRow {
  id: string
  name: string
  price: string
  taxable: boolean
}

interface OptionRow {
  id: string
  group_id: string
  name: string
  price_delta: string
}

/**
 * A register order, priced by the server.
 *
 * This exists instead of reusing `POST /api/orders` for three reasons, each of
 * which would be a bug if worked around:
 *
 *  1. A POS token carries `portalScope: 'pos'`, which requireAuth confines to
 *     `/api/pos/*`. Reaching the dashboard order route would mean widening that
 *     scope, which is the whole boundary keeping a register PIN away from
 *     /api/contacts.
 *  2. `POST /api/orders` hard-codes `source: 'staff'`. The 'pos' value the
 *     constraint was widened for in 0195 is unreachable from there.
 *  3. Its line items have no `menu_item_id` and no `modifiers`, and the kitchen
 *     ticket router routes by exactly those two columns. Firing such an order
 *     would put every line on the unrouted ticket.
 *
 * Prices are read from the menu, never from the request body. A register is a
 * device sitting in a public room; if the body could name a price, the till
 * could be emptied by editing one number in a fetch call.
 */
router.post('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const supabase = getServiceClient()

  const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
  if (!locationId) {
    // Not optional: an order with no location cannot be fired to a kitchen, and
    // POST /api/pos/tickets/fire rejects it after the order already exists.
    res.status(400).json({ error: 'location_id is required' })
    return
  }

  const lines = parseLines(body['lines'])
  if (!lines) {
    res.status(400).json({ error: 'At least one valid line is required' })
    return
  }

  const { data: location } = await supabase
    .from('locations')
    .select('id')
    .eq('id', locationId)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle<{ id: string }>()
  if (!location) {
    res.status(404).json({ error: 'Location not found' })
    return
  }

  // Every menu row is fetched tenant-scoped, so a body naming another tenant's
  // item or option simply finds nothing and 400s, rather than pricing a line
  // off a foreign menu.
  const itemIds = [...new Set(lines.map((l) => l.menuItemId))]
  const { data: itemRows } = await supabase
    .from('menu_items')
    .select('id, name, price, taxable')
    .eq('tenant_id', authed.tenantId)
    .in('id', itemIds)

  const itemsById = new Map<string, MenuItemRow>()
  for (const row of (itemRows ?? []) as MenuItemRow[]) itemsById.set(row.id, row)

  const missingItem = itemIds.find((id) => !itemsById.has(id))
  if (missingItem) {
    res.status(400).json({ error: `Menu item not found: ${missingItem}` })
    return
  }

  const optionIds = [...new Set(lines.flatMap((l) => l.optionIds))]
  const optionsById = new Map<string, OptionRow>()
  // Which groups each item actually offers. An option belonging to the tenant
  // is not enough — "extra guacamole" priced for a burrito must not be
  // attachable to a coffee, which is how a $0.00 upgrade path appears.
  const groupsByItem = new Map<string, Set<string>>()

  if (optionIds.length > 0) {
    const [{ data: optionRows }, { data: junctionRows }] = await Promise.all([
      supabase
        .from('modifier_options')
        .select('id, group_id, name, price_delta')
        .eq('tenant_id', authed.tenantId)
        .in('id', optionIds),
      supabase
        .from('menu_item_modifier_groups')
        .select('item_id, group_id')
        .eq('tenant_id', authed.tenantId)
        .in('item_id', itemIds),
    ])

    for (const row of (optionRows ?? []) as OptionRow[]) optionsById.set(row.id, row)
    for (const row of (junctionRows ?? []) as { item_id: string; group_id: string }[]) {
      const set = groupsByItem.get(row.item_id) ?? new Set<string>()
      set.add(row.group_id)
      groupsByItem.set(row.item_id, set)
    }
  }

  let subtotalCents = 0
  let taxableBaseCents = 0
  const itemInserts: Record<string, unknown>[] = []

  for (const [index, line] of lines.entries()) {
    const item = itemsById.get(line.menuItemId) as MenuItemRow
    const chosen: OptionRow[] = []

    for (const optionId of line.optionIds) {
      const option = optionsById.get(optionId)
      if (!option) {
        res.status(400).json({ error: `Modifier option not found: ${optionId}` })
        return
      }
      if (!groupsByItem.get(line.menuItemId)?.has(option.group_id)) {
        res.status(400).json({ error: `Modifier option ${optionId} is not offered on this item` })
        return
      }
      chosen.push(option)
    }

    // order_line_items.total is GENERATED as quantity * unit_price, so the
    // modifier deltas have to be folded into unit_price. Storing the base price
    // and the deltas separately would make the generated column disagree with
    // the amount the customer was charged.
    const modifierDeltaCents = chosen.reduce((sum, o) => sum + toCents(o.price_delta), 0)
    const unitPriceCents = toCents(item.price) + modifierDeltaCents
    const lineTotalCents = unitPriceCents * line.quantity

    subtotalCents += lineTotalCents
    if (item.taxable) taxableBaseCents += lineTotalCents

    itemInserts.push({
      tenant_id: authed.tenantId,
      menu_item_id: item.id,
      description: item.name,
      quantity: line.quantity,
      unit_price: Number(toDollars(unitPriceCents)),
      notes: line.notes,
      sort_order: index,
      // Snapshot, not a join: a price change or a deleted option tomorrow must
      // not rewrite what this customer was charged or what the kitchen was told
      // to cook. Shape matches what kitchen_ticket_items copies verbatim.
      modifiers: chosen.map((o) => ({
        option_id: o.id,
        option_name: o.name,
        price_delta: o.price_delta,
      })),
    })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('tax_rate')
    .eq('id', authed.tenantId)
    .maybeSingle<{ tax_rate: string | number | null }>()

  // tenants.tax_rate is a percentage (8.75 means 8.75%); basis points keep the
  // arithmetic in integers, exactly as /api/pos/settings hands it to the client
  // so the two agree to the cent.
  const taxPercent = Number(tenant?.tax_rate ?? 0)
  const taxRateBps = Number.isFinite(taxPercent) ? Math.round(taxPercent * 100) : 0
  // Rounded once on the summed base, matching cartTotals in @nuatis/pos-core.
  // Rounding per line drifts up to a cent per line off the printed subtotal.
  const taxCents = Math.round((taxableBaseCents * taxRateBps) / 10000)

  const tipCents = toCents(typeof body['tip_amount'] === 'number' ? body['tip_amount'] : 0)
  if (tipCents < 0) {
    res.status(400).json({ error: 'tip_amount must not be negative' })
    return
  }

  const payments = parsePayments(body['payments'])
  if (!payments) {
    res.status(400).json({ error: 'Invalid payments' })
    return
  }

  const totalCents = subtotalCents + taxCents + tipCents
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0)

  const orderNumber = await generateOrderNumber(authed.tenantId)
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      tenant_id: authed.tenantId,
      order_number: orderNumber,
      // 'pos' only became legal when 0195 widened orders_source_check. It is
      // what separates register revenue from dashboard-entered orders in every
      // report downstream.
      source: 'pos',
      // A register sale is taken and fired in one motion — there is no state in
      // which it sits waiting to be confirmed.
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      customer_name:
        typeof body['customer_name'] === 'string' && body['customer_name'].trim() !== ''
          ? body['customer_name'].trim()
          : 'Walk-in',
      location_id: locationId,
      fulfillment_type: 'dine_in',
      subtotal: Number(toDollars(subtotalCents)),
      tax_rate: taxPercent,
      tax_amount: Number(toDollars(taxCents)),
      tip_amount: Number(toDollars(tipCents)),
      total: Number(toDollars(totalCents)),
      // Change given is not revenue: a $20 note against a $17.50 ticket pays
      // $17.50. Capping at the total is what keeps balance_due from going
      // negative on every cash sale.
      amount_paid: Number(toDollars(Math.min(paidCents, totalCents))),
      payment_status:
        paidCents >= totalCents && totalCents > 0 ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid',
      notes: typeof body['notes'] === 'string' ? body['notes'] : null,
      metadata: {},
    })
    .select('*')
    .single<{ id: string }>()

  if (orderErr || !order) {
    res.status(500).json({ error: orderErr?.message ?? 'Failed to create order' })
    return
  }

  const { data: insertedLines, error: linesErr } = await supabase
    .from('order_line_items')
    .insert(itemInserts.map((row) => ({ ...row, order_id: order.id })))
    .select('*')

  if (linesErr) {
    res.status(500).json({ error: 'Failed to create order line items' })
    return
  }

  if (payments.length > 0) {
    // One row per tender leg, so a split payment reads back as the two cards it
    // actually was rather than one merged amount nobody can reconcile.
    await supabase.from('order_payments').insert(
      payments.map((p) => ({
        order_id: order.id,
        tenant_id: authed.tenantId,
        amount: Number(toDollars(p.amountCents)),
        method: p.method,
      }))
    )
  }

  res.status(201).json({ ...order, line_items: insertedLines ?? [] })
})

/** Lines as the register sends them: an item, a count, and the chosen options. */
function parseLines(value: unknown): LineInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const lines: LineInput[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const row = raw as Record<string, unknown>
    const menuItemId = typeof row['menu_item_id'] === 'string' ? row['menu_item_id'] : ''
    const quantity = typeof row['quantity'] === 'number' ? row['quantity'] : 0
    if (!menuItemId) return null
    // Fractional quantities are meaningful for a service line but not for a
    // plate of food, and they would put a fraction of a cent in the line total.
    if (!Number.isInteger(quantity) || quantity <= 0) return null
    const optionIds = Array.isArray(row['option_ids'])
      ? row['option_ids'].filter((id): id is string => typeof id === 'string')
      : []
    lines.push({
      menuItemId,
      quantity,
      optionIds,
      notes: typeof row['notes'] === 'string' && row['notes'] !== '' ? row['notes'] : null,
    })
  }
  return lines
}

function parsePayments(value: unknown): { method: TenderMethod; amountCents: number }[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const payments: { method: TenderMethod; amountCents: number }[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const row = raw as Record<string, unknown>
    const method = row['method']
    if (typeof method !== 'string' || !(TENDER_METHODS as readonly string[]).includes(method)) {
      return null
    }
    const amount = typeof row['amount'] === 'number' ? row['amount'] : NaN
    if (!Number.isFinite(amount) || amount <= 0) return null
    payments.push({ method: method as TenderMethod, amountCents: toCents(amount) })
  }
  return payments
}

export default router
