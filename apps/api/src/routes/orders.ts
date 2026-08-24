import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'
import { generateOrderNumber } from '../lib/order-number.js'
import { sendSms } from '../lib/sms.js'
import {
  buildOrderConfirmationSms,
  buildOrderReadySms,
  buildOrderCompletedSms,
} from '../lib/sms-templates.js'

const router = Router()

async function requireOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'orders')
  if (!enabled) {
    res.status(403).json({ error: 'Orders module is not enabled' })
    return
  }
  next()
}

const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'ready',
  'completed',
  'cancelled',
] as const
type OrderStatus = (typeof ORDER_STATUSES)[number]

// Explicit allowed-transitions map — the kanban board and any manual status
// change must both go through this, not a free-form status write.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

interface LineItemInput {
  service_id?: string | null
  inventory_item_id?: string | null
  description: string
  quantity: number
  unit_price: number
  notes?: string | null
}

function calcTotals(items: LineItemInput[], taxRate: number) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2))
  const total = Number((subtotal + taxAmount).toFixed(2))
  return { subtotal: Number(subtotal.toFixed(2)), taxAmount, total }
}

function validateLineItems(raw: unknown): LineItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const items: LineItemInput[] = []
  for (const entry of raw as Record<string, unknown>[]) {
    const description = typeof entry['description'] === 'string' ? entry['description'].trim() : ''
    const quantity = typeof entry['quantity'] === 'number' ? entry['quantity'] : NaN
    const unitPrice = typeof entry['unit_price'] === 'number' ? entry['unit_price'] : NaN
    if (
      !description ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice)
    ) {
      return null
    }
    items.push({
      service_id: (entry['service_id'] as string) || null,
      inventory_item_id: (entry['inventory_item_id'] as string) || null,
      description,
      quantity,
      unit_price: unitPrice,
      notes: (entry['notes'] as string) || null,
    })
  }
  return items
}

async function getOrderSettings(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string
): Promise<{ autoDeductInventory: boolean }> {
  const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).single()
  const settings = (data?.settings as Record<string, unknown> | null) ?? {}
  return { autoDeductInventory: settings['orders_auto_deduct_inventory'] === true }
}

// ── GET /api/orders ───────────────────────────────────────────────────────────
router.get('/', requireAuth, requireOrders, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const countOnly = req.query['count'] === 'true'
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : ''
  const contactId = typeof req.query['contact_id'] === 'string' ? req.query['contact_id'] : ''
  const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : ''

  if (countOnly) {
    let countQuery = supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
    if (status) countQuery = countQuery.eq('status', status)
    const { count, error } = await countQuery
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ count: count ?? 0 })
    return
  }

  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('orders')
    .select('*, contacts(full_name), staff_members(name)', { count: 'exact' })
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)

  if (status) query = query.eq('status', status)
  if (contactId) query = query.eq('contact_id', contactId)
  if (q) {
    const pat = `%${q}%`
    query = query.or(`order_number.ilike.${pat},customer_name.ilike.${pat}`)
  }

  query = query.order('created_at', { ascending: false }).range(from, to)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [], total: count ?? 0, page })
})

// ── POST /api/orders ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireOrders, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const lineItems = validateLineItems(b['line_items'])
  if (!lineItems) {
    res.status(400).json({ error: 'At least one valid line item is required' })
    return
  }

  const contactId = (b['contact_id'] as string) || null
  const customerName = typeof b['customer_name'] === 'string' ? b['customer_name'].trim() : null
  const customerPhone = typeof b['customer_phone'] === 'string' ? b['customer_phone'].trim() : null

  if (!contactId && !customerName) {
    res.status(400).json({ error: 'contact_id or customer_name is required' })
    return
  }

  const fulfillmentType = typeof b['fulfillment_type'] === 'string' ? b['fulfillment_type'] : null
  if (fulfillmentType && !['pickup', 'delivery', 'dine_in'].includes(fulfillmentType)) {
    res.status(400).json({ error: 'Invalid fulfillment_type' })
    return
  }

  const { data: tenantTax } = await supabase
    .from('tenants')
    .select('tax_rate')
    .eq('id', authed.tenantId)
    .single()
  const taxRate =
    typeof b['tax_rate'] === 'number' ? b['tax_rate'] : Number(tenantTax?.tax_rate ?? 0)

  const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate)
  const orderNumber = await generateOrderNumber(authed.tenantId)

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: contactId,
      order_number: orderNumber,
      status: 'pending',
      source: 'staff',
      customer_name: customerName,
      customer_phone: customerPhone,
      fulfillment_type: fulfillmentType,
      requested_ready_time: (b['requested_ready_time'] as string) || null,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total,
      notes: (b['notes'] as string) || null,
      assigned_staff_id: (b['assigned_staff_id'] as string) || null,
      deal_id: (b['deal_id'] as string) || null,
    })
    .select('*')
    .single()

  if (orderErr || !order) {
    res.status(500).json({ error: orderErr?.message ?? 'Failed to create order' })
    return
  }

  const itemRows = lineItems.map((item, i) => ({
    order_id: order.id,
    tenant_id: authed.tenantId,
    service_id: item.service_id,
    inventory_item_id: item.inventory_item_id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    notes: item.notes,
    sort_order: i,
  }))

  const { data: items } = await supabase.from('order_line_items').insert(itemRows).select('*')

  void logActivity({
    tenantId: authed.tenantId,
    contactId: contactId ?? undefined,
    type: 'order',
    body: `Order created: ${orderNumber} — $${total.toFixed(2)}`,
    metadata: { order_id: order.id, status: 'pending' },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json({ ...order, line_items: items ?? [] })
})

// ── GET /api/orders/:id ────────────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: order, error } = await supabase
      .from('orders')
      .select(
        '*, contacts(full_name, phone, email), staff_members(name), deals(title), quotes(quote_number)'
      )
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (error || !order) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data: lineItems } = await supabase
      .from('order_line_items')
      .select('*')
      .eq('order_id', order.id)
      .eq('tenant_id', authed.tenantId)
      .order('sort_order', { ascending: true })

    const { data: payments } = await supabase
      .from('order_payments')
      .select('*')
      .eq('order_id', order.id)
      .eq('tenant_id', authed.tenantId)
      .order('recorded_at', { ascending: false })

    res.json({ ...order, line_items: lineItems ?? [], payments: payments ?? [] })
  }
)

// ── PUT /api/orders/:id ─────────────────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const updates: Record<string, unknown> = {}

    if (typeof b['customer_name'] === 'string') updates['customer_name'] = b['customer_name'].trim()
    if (b['customer_name'] === null) updates['customer_name'] = null
    if (typeof b['customer_phone'] === 'string')
      updates['customer_phone'] = b['customer_phone'].trim()
    if (b['customer_phone'] === null) updates['customer_phone'] = null
    if (typeof b['contact_id'] === 'string') updates['contact_id'] = b['contact_id']
    if (b['contact_id'] === null) updates['contact_id'] = null
    if (typeof b['assigned_staff_id'] === 'string')
      updates['assigned_staff_id'] = b['assigned_staff_id']
    if (b['assigned_staff_id'] === null) updates['assigned_staff_id'] = null
    if (typeof b['deal_id'] === 'string') updates['deal_id'] = b['deal_id']
    if (b['deal_id'] === null) updates['deal_id'] = null

    if (b['fulfillment_type'] !== undefined) {
      if (
        b['fulfillment_type'] !== null &&
        !['pickup', 'delivery', 'dine_in'].includes(b['fulfillment_type'] as string)
      ) {
        res.status(400).json({ error: 'Invalid fulfillment_type' })
        return
      }
      updates['fulfillment_type'] = b['fulfillment_type']
    }
    if (b['requested_ready_time'] !== undefined)
      updates['requested_ready_time'] = b['requested_ready_time']
    if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
    if (b['notes'] === null) updates['notes'] = null

    if (b['tax_rate'] !== undefined) {
      if (typeof b['tax_rate'] !== 'number' || b['tax_rate'] < 0) {
        res.status(400).json({ error: 'tax_rate must be a number >= 0' })
        return
      }
      // Recompute totals from existing line items against the new tax rate.
      const { data: lineItems } = await supabase
        .from('order_line_items')
        .select('quantity, unit_price')
        .eq('order_id', req.params['id'])
        .eq('tenant_id', authed.tenantId)
      const { subtotal, taxAmount, total } = calcTotals(
        (lineItems ?? []).map((li) => ({
          description: '',
          quantity: Number(li.quantity),
          unit_price: Number(li.unit_price),
        })),
        b['tax_rate']
      )
      updates['tax_rate'] = b['tax_rate']
      updates['subtotal'] = subtotal
      updates['tax_amount'] = taxAmount
      updates['total'] = total
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' })
      return
    }

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .select('*')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.json(data)
  }
)

// ── PUT /api/orders/:id/line-items — replace wholesale ─────────────────────────
router.put(
  '/:id/line-items',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const lineItems = validateLineItems(b['line_items'])
    if (!lineItems) {
      res.status(400).json({ error: 'At least one valid line item is required' })
      return
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, tax_rate')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !order) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { subtotal, taxAmount, total } = calcTotals(lineItems, Number(order.tax_rate ?? 0))

    await supabase
      .from('order_line_items')
      .delete()
      .eq('order_id', order.id)
      .eq('tenant_id', authed.tenantId)

    const itemRows = lineItems.map((item, i) => ({
      order_id: order.id,
      tenant_id: authed.tenantId,
      service_id: item.service_id,
      inventory_item_id: item.inventory_item_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: item.notes,
      sort_order: i,
    }))
    const { data: items } = await supabase.from('order_line_items').insert(itemRows).select('*')

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({ subtotal, tax_amount: taxAmount, total })
      .eq('id', order.id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to update line items' })
      return
    }

    res.json({ ...updated, line_items: items ?? [] })
  }
)

// ── PUT /api/orders/:id/status — dedicated status-transition endpoint ──────────
router.put(
  '/:id/status',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const nextStatus = b['status'] as string
    if (!ORDER_STATUSES.includes(nextStatus as OrderStatus)) {
      res.status(400).json({ error: `status must be one of ${ORDER_STATUSES.join(', ')}` })
      return
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !order) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const currentStatus = order.status as OrderStatus
    const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(nextStatus as OrderStatus)) {
      res.status(400).json({
        error: `Cannot transition from ${currentStatus} to ${nextStatus}`,
        allowed_transitions: allowed,
      })
      return
    }

    const updates: Record<string, unknown> = { status: nextStatus }
    const now = new Date().toISOString()
    if (nextStatus === 'confirmed') updates['confirmed_at'] = now
    if (nextStatus === 'completed') updates['completed_at'] = now
    if (nextStatus === 'cancelled') {
      updates['cancelled_at'] = now
      updates['cancel_reason'] = (b['cancel_reason'] as string) || null
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', order.id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to update status' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      contactId: order.contact_id ?? undefined,
      type: 'order_status_change',
      body: `Order ${order.order_number} moved from ${currentStatus} to ${nextStatus}`,
      metadata: { order_id: order.id, from: currentStatus, to: nextStatus },
      actorType: 'user',
      actorId: authed.userId,
    })

    // Inventory deduction — only on completion, only if the tenant opted in.
    // Wrapped so a failure here never blocks the status-change response.
    if (nextStatus === 'completed') {
      try {
        const { autoDeductInventory } = await getOrderSettings(supabase, authed.tenantId)
        if (autoDeductInventory) {
          const { data: lineItems } = await supabase
            .from('order_line_items')
            .select('inventory_item_id, quantity')
            .eq('order_id', order.id)
            .not('inventory_item_id', 'is', null)

          for (const li of lineItems ?? []) {
            const itemId = li['inventory_item_id'] as string | null
            const lineQty = Number(li['quantity'] ?? 0)
            if (!itemId || lineQty <= 0) continue

            const { data: item } = await supabase
              .from('inventory_items')
              .select('id, name, quantity')
              .eq('id', itemId)
              .eq('tenant_id', authed.tenantId)
              .is('deleted_at', null)
              .single()
            if (!item) continue

            const currentQty = Number(item.quantity ?? 0)
            const newQty = Math.max(0, currentQty - lineQty)
            const clamped = currentQty - lineQty < 0

            await supabase
              .from('inventory_items')
              .update({ quantity: newQty, updated_at: now })
              .eq('id', item.id)
              .eq('tenant_id', authed.tenantId)

            void logActivity({
              tenantId: authed.tenantId,
              type: 'inventory_adjust',
              body: `Inventory deducted: -${lineQty} ${item.name} (Order ${order.order_number} completed)`,
              metadata: {
                item_id: item.id,
                item_name: item.name,
                delta: -lineQty,
                new_quantity: newQty,
                order_id: order.id,
                clamped,
              },
              actorType: 'user',
            })
          }
        }
      } catch (err) {
        console.error('[orders] inventory auto-deduct failed:', err)
      }

      // Deal value rollup — additive only, never overwrites a rep-set value:
      // completing an order adds its total to the linked deal's value. Fires
      // once, since ALLOWED_TRANSITIONS['completed'] is terminal — no
      // double-counting risk from re-entering this branch for the same order.
      if (order.deal_id) {
        try {
          const { data: deal } = await supabase
            .from('deals')
            .select('id, value, is_closed_won, title')
            .eq('id', order.deal_id)
            .eq('tenant_id', authed.tenantId)
            .maybeSingle()

          if (deal) {
            const newValue = Number(deal.value ?? 0) + Number(order.total ?? 0)
            const dealUpdates: Record<string, unknown> = { value: newValue }
            // Order completion = one-off sale done → close the deal won.
            // Only flips false → true, never re-fires for a deal already won
            // (e.g. a second order later linked to the same deal).
            if (!deal.is_closed_won) dealUpdates['is_closed_won'] = true

            await supabase
              .from('deals')
              .update(dealUpdates)
              .eq('id', deal.id)
              .eq('tenant_id', authed.tenantId)

            void logActivity({
              tenantId: authed.tenantId,
              contactId: order.contact_id ?? undefined,
              type: 'order',
              body: `Order ${order.order_number} completed — added $${Number(order.total).toFixed(2)} to linked deal value`,
              metadata: {
                order_id: order.id,
                deal_id: deal.id,
                added: order.total,
                new_value: newValue,
              },
              actorType: 'user',
              actorId: authed.userId,
            })

            if (!deal.is_closed_won) {
              void logActivity({
                tenantId: authed.tenantId,
                contactId: order.contact_id ?? undefined,
                type: 'system',
                body: `Deal won: "${deal.title}" — $${newValue.toFixed(2)}`,
                metadata: { deal_id: deal.id, order_id: order.id },
                actorType: 'user',
                actorId: authed.userId,
              })
            }
          }
        } catch (err) {
          console.error('[orders] deal value rollup failed:', err)
        }
      }
    }

    // SMS notification — best-effort, never blocks the response.
    if (['confirmed', 'ready', 'completed'].includes(nextStatus)) {
      void (async () => {
        try {
          const phone = order.customer_phone as string | null
          if (!phone) return

          const { data: location } = await supabase
            .from('locations')
            .select('telnyx_number')
            .eq('tenant_id', authed.tenantId)
            .eq('is_primary', true)
            .maybeSingle()
          const fromNumber = location?.telnyx_number as string | null
          if (!fromNumber) return

          const { data: tenantRow } = await supabase
            .from('tenants')
            .select('name, vertical')
            .eq('id', authed.tenantId)
            .maybeSingle()
          const businessName = (tenantRow?.name as string) || 'the business'
          const vertical = (tenantRow?.vertical as string) || ''

          const params = {
            contactName: (order.customer_name as string) || null,
            businessName,
            orderNumber: order.order_number as string,
            vertical,
          }
          const text =
            nextStatus === 'confirmed'
              ? buildOrderConfirmationSms(params)
              : nextStatus === 'ready'
                ? buildOrderReadySms(params)
                : buildOrderCompletedSms(params)

          await sendSms(fromNumber, phone, text, {
            tenantId: authed.tenantId,
            contactId: order.contact_id ?? undefined,
          })
        } catch (err) {
          console.error('[orders] status-change SMS failed:', err)
        }
      })()
    }

    res.json(updated)
  }
)

// ── POST /api/orders/:id/payments ───────────────────────────────────────────────
router.post(
  '/:id/payments',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const amount = typeof b['amount'] === 'number' ? b['amount'] : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a number > 0' })
      return
    }
    const method = typeof b['method'] === 'string' ? b['method'].trim() : ''
    if (!method) {
      res.status(400).json({ error: 'method is required' })
      return
    }

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, total, amount_paid, order_number')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !order) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data: payment, error: paymentErr } = await supabase
      .from('order_payments')
      .insert({
        order_id: order.id,
        tenant_id: authed.tenantId,
        amount,
        method,
        reference: (b['reference'] as string) || null,
        recorded_by: authed.appUserId,
        notes: (b['notes'] as string) || null,
      })
      .select('*')
      .single()

    if (paymentErr || !payment) {
      res.status(500).json({ error: paymentErr?.message ?? 'Failed to record payment' })
      return
    }

    const newAmountPaid = Number(order.amount_paid ?? 0) + amount
    const total = Number(order.total ?? 0)
    const paymentStatus = newAmountPaid >= total ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid'

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({ amount_paid: newAmountPaid, payment_status: paymentStatus })
      .eq('id', order.id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (updateErr || !updatedOrder) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to update order payment status' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      type: 'order',
      body: `Payment recorded on ${order.order_number}: $${amount.toFixed(2)} (${method})`,
      metadata: { order_id: order.id, payment_id: payment.id, amount, method },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.status(201).json({ payment, order: updatedOrder })
  }
)

// ── DELETE /api/orders/:id (soft) ────────────────────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireOrders,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !order) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (!['pending', 'cancelled'].includes(order.status as string)) {
      res.status(400).json({ error: 'Only pending or cancelled orders can be deleted' })
      return
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('tenant_id', authed.tenantId)
      .select('id')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to delete' })
      return
    }

    res.json({ success: true })
  }
)

export default router
