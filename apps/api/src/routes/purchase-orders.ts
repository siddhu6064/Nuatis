import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'
import { generatePoNumber } from '../lib/po-number.js'

const router = Router()

async function requireCrm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'crm')
  if (!enabled) {
    res.status(403).json({ error: 'CRM module is not enabled' })
    return
  }
  next()
}

interface ItemInput {
  inventory_item_id?: string | null
  description: string
  quantity_ordered: number
  unit_cost: number
}

function validateItems(
  raw: unknown
): { ok: true; items: ItemInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'items must be a non-empty array' }
  }
  const items: ItemInput[] = []
  for (const entry of raw) {
    const r = entry as Record<string, unknown>
    const description = typeof r['description'] === 'string' ? r['description'].trim() : ''
    const quantityOrdered = r['quantity_ordered']
    const unitCost = r['unit_cost']
    if (!description) return { ok: false, error: 'each item requires a description' }
    if (
      typeof quantityOrdered !== 'number' ||
      !Number.isInteger(quantityOrdered) ||
      quantityOrdered <= 0
    ) {
      return { ok: false, error: 'each item requires quantity_ordered as a positive integer' }
    }
    if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0) {
      return { ok: false, error: 'each item requires unit_cost as a number >= 0' }
    }
    items.push({
      inventory_item_id: typeof r['inventory_item_id'] === 'string' ? r['inventory_item_id'] : null,
      description,
      quantity_ordered: quantityOrdered,
      unit_cost: unitCost,
    })
  }
  return { ok: true, items }
}

// ── GET /api/purchase-orders ─────────────────────────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  let query = supabase
    .from('purchase_orders')
    .select('*, vendors(name)')
    .eq('tenant_id', authed.tenantId)

  if (typeof req.query['status'] === 'string') query = query.eq('status', req.query['status'])
  if (typeof req.query['vendor_id'] === 'string')
    query = query.eq('vendor_id', req.query['vendor_id'])

  query = query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = (data ?? []).map((r) => {
    const vendor = r['vendors'] as { name?: string } | null
    return { ...r, vendor_name: vendor?.name ?? null }
  })
  res.json({ data: rows })
})

// ── POST /api/purchase-orders ────────────────────────────────────────────────
router.post('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const vendorId = typeof b['vendor_id'] === 'string' ? b['vendor_id'] : ''
  if (!vendorId) {
    res.status(400).json({ error: 'vendor_id is required' })
    return
  }

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id')
    .eq('id', vendorId)
    .eq('tenant_id', authed.tenantId)
    .single()
  if (!vendor) {
    res.status(404).json({ error: 'Vendor not found' })
    return
  }

  const itemsValidation = validateItems(b['items'])
  if (!itemsValidation.ok) {
    res.status(400).json({ error: itemsValidation.error })
    return
  }
  const items = itemsValidation.items
  const subtotal = items.reduce((sum, i) => sum + i.quantity_ordered * i.unit_cost, 0)

  const poNumber = await generatePoNumber(authed.tenantId)

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      tenant_id: authed.tenantId,
      vendor_id: vendorId,
      po_number: poNumber,
      status: 'draft',
      expected_date: typeof b['expected_date'] === 'string' ? b['expected_date'] : null,
      notes: typeof b['notes'] === 'string' ? b['notes'] : null,
      subtotal,
      created_by: authed.appUserId,
    })
    .select('*')
    .single()

  if (poError || !po) {
    res.status(500).json({ error: poError?.message ?? 'Failed to create purchase order' })
    return
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(
      items.map((i) => ({
        purchase_order_id: po.id,
        tenant_id: authed.tenantId,
        inventory_item_id: i.inventory_item_id,
        description: i.description,
        quantity_ordered: i.quantity_ordered,
        quantity_received: 0,
        unit_cost: i.unit_cost,
      }))
    )
    .select('*')

  if (itemsError) {
    // Roll back the header — a PO with zero items is meaningless.
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    res.status(500).json({ error: itemsError.message })
    return
  }

  void logActivity({
    tenantId: authed.tenantId,
    type: 'system',
    body: `Purchase order ${poNumber} created (${items.length} item${items.length === 1 ? '' : 's'})`,
    metadata: { po_id: po.id, po_number: poNumber },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json({ ...po, items: insertedItems ?? [] })
})

// ── GET /api/purchase-orders/:id ─────────────────────────────────────────────
router.get('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('*, vendors(name, email, phone)')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !po) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', po.id)
    .order('created_at', { ascending: true })

  res.json({ ...po, items: items ?? [] })
})

// ── PUT /api/purchase-orders/:id ─────────────────────────────────────────────
// Header-only edits, and only while still a draft — once sent, the vendor may
// already be acting on it.
router.put('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()
  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (existing.status !== 'draft') {
    res.status(409).json({ error: 'Only a draft purchase order can be edited' })
    return
  }

  const updates: Record<string, unknown> = {}
  if (typeof b['vendor_id'] === 'string') updates['vendor_id'] = b['vendor_id']
  if (typeof b['expected_date'] === 'string') updates['expected_date'] = b['expected_date']
  if (b['expected_date'] === null) updates['expected_date'] = null
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to update' })
    return
  }
  res.json(data)
})

// ── POST /api/purchase-orders/:id/send ───────────────────────────────────────
router.post(
  '/:id/send',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: existing } = await supabase
      .from('purchase_orders')
      .select('id, status, po_number')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()
    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.status !== 'draft') {
      res.status(409).json({ error: 'Only a draft purchase order can be sent' })
      return
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to send' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      type: 'system',
      body: `Purchase order ${existing.po_number} marked sent`,
      metadata: { po_id: existing.id },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json(data)
  }
)

// ── POST /api/purchase-orders/:id/cancel ─────────────────────────────────────
router.post(
  '/:id/cancel',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: existing } = await supabase
      .from('purchase_orders')
      .select('id, status, po_number')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()
    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.status === 'received' || existing.status === 'cancelled') {
      res.status(409).json({ error: `Cannot cancel a ${existing.status} purchase order` })
      return
    }

    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to cancel' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      type: 'system',
      body: `Purchase order ${existing.po_number} cancelled`,
      metadata: { po_id: existing.id },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json(data)
  }
)

// ── POST /api/purchase-orders/:id/receive ────────────────────────────────────
// Body: { items: [{ item_id (purchase_order_items.id), quantity_received_now }] }
// quantity_received_now is the delta received in THIS shipment, not a total —
// bumps inventory_items.quantity by the same delta for any item with a linked
// inventory_item_id, and refreshes that item's unit_cost from the PO.
router.post(
  '/:id/receive',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const { data: po } = await supabase
      .from('purchase_orders')
      .select('id, status, po_number')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()
    if (!po) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (po.status !== 'sent' && po.status !== 'partial') {
      res.status(409).json({ error: `Cannot receive against a ${po.status} purchase order` })
      return
    }

    const rawItems = b['items']
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: 'items must be a non-empty array' })
      return
    }

    const { data: poItems, error: poItemsError } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)
    if (poItemsError || !poItems) {
      res.status(500).json({ error: poItemsError?.message ?? 'Failed to load items' })
      return
    }
    const poItemsById = new Map(poItems.map((i) => [i.id as string, i]))

    for (const entry of rawItems) {
      const r = entry as Record<string, unknown>
      const itemId = typeof r['item_id'] === 'string' ? r['item_id'] : ''
      const deltaRaw = r['quantity_received_now']
      const item = poItemsById.get(itemId)
      if (!item) {
        res.status(400).json({ error: `item_id ${itemId} does not belong to this purchase order` })
        return
      }
      if (typeof deltaRaw !== 'number' || !Number.isInteger(deltaRaw) || deltaRaw <= 0) {
        res
          .status(400)
          .json({ error: `quantity_received_now for ${itemId} must be a positive integer` })
        return
      }
      const currentReceived = Number(item['quantity_received'] ?? 0)
      const ordered = Number(item['quantity_ordered'] ?? 0)
      const newReceived = Math.min(ordered, currentReceived + deltaRaw)

      await supabase
        .from('purchase_order_items')
        .update({ quantity_received: newReceived })
        .eq('id', itemId)
        .eq('tenant_id', authed.tenantId)

      const inventoryItemId = item['inventory_item_id'] as string | null
      if (inventoryItemId) {
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('id, quantity')
          .eq('id', inventoryItemId)
          .eq('tenant_id', authed.tenantId)
          .is('deleted_at', null)
          .single()
        if (invItem) {
          const actualDelta = newReceived - currentReceived
          await supabase
            .from('inventory_items')
            .update({
              quantity: Number(invItem.quantity ?? 0) + actualDelta,
              unit_cost: item['unit_cost'],
            })
            .eq('id', inventoryItemId)
            .eq('tenant_id', authed.tenantId)
        }
      }
    }

    const { data: refreshedItems } = await supabase
      .from('purchase_order_items')
      .select('quantity_ordered, quantity_received')
      .eq('purchase_order_id', po.id)
    const allReceived = (refreshedItems ?? []).every(
      (i) => Number(i.quantity_received ?? 0) >= Number(i.quantity_ordered ?? 0)
    )
    const anyReceived = (refreshedItems ?? []).some((i) => Number(i.quantity_received ?? 0) > 0)
    const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status

    const { data: updatedPo, error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        status: newStatus,
        ...(newStatus === 'received' ? { received_at: new Date().toISOString() } : {}),
      })
      .eq('id', po.id)
      .select('*')
      .single()

    if (updateError || !updatedPo) {
      res.status(500).json({ error: updateError?.message ?? 'Failed to update status' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      type: 'inventory_adjust',
      body: `Purchase order ${po.po_number} received (${newStatus})`,
      metadata: { po_id: po.id, status: newStatus },
      actorType: 'user',
      actorId: authed.userId,
    })

    const { data: finalItems } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)

    res.json({ ...updatedPo, items: finalItems ?? [] })
  }
)

// ── DELETE /api/purchase-orders/:id (hard — only while draft) ────────────────
router.delete(
  '/:id',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: existing } = await supabase
      .from('purchase_orders')
      .select('id, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()
    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.status !== 'draft') {
      res.status(409).json({ error: 'Only a draft purchase order can be deleted' })
      return
    }

    await supabase
      .from('purchase_orders')
      .delete()
      .eq('id', existing.id)
      .eq('tenant_id', authed.tenantId)
    res.json({ success: true })
  }
)

export default router
