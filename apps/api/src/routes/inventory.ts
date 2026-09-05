import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'
import { VALID_UNITS, type Unit } from './inventory-logic.js'

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

// A variant (parent_item_id set) and a kit (has inventory_kit_components rows
// as the kit) are kept mutually exclusive — one item shouldn't try to be both
// at once, to keep the mental model simple. Returns an error string, or null
// if valid. `selfId` is omitted on create (nothing to conflict with yet).
async function validateParentItem(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  parentItemId: string,
  selfId?: string
): Promise<string | null> {
  if (parentItemId === selfId) {
    return 'An item cannot be its own variant parent'
  }

  const { data: parent } = await supabase
    .from('inventory_items')
    .select('id, parent_item_id')
    .eq('id', parentItemId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!parent) return 'parent_item_id does not reference an existing item'
  if (parent.parent_item_id) return 'parent_item_id cannot itself be a variant (no nested variants)'

  const { data: parentAsKit } = await supabase
    .from('inventory_kit_components')
    .select('id')
    .eq('kit_item_id', parentItemId)
    .limit(1)
  if (parentAsKit && parentAsKit.length > 0) {
    return 'parent_item_id is a kit — an item cannot be a variant of a kit'
  }

  if (selfId) {
    const { data: selfAsKit } = await supabase
      .from('inventory_kit_components')
      .select('id')
      .eq('kit_item_id', selfId)
      .limit(1)
    if (selfAsKit && selfAsKit.length > 0) {
      return 'This item is a kit — a kit cannot also be a variant'
    }
  }

  return null
}

// ── GET /api/inventory ───────────────────────────────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const countOnly = req.query['count'] === 'true'
  const lowStock = req.query['low_stock'] === 'true'
  const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : ''
  const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''

  // Count-only path (used by sidebar low-stock badge polling)
  if (countOnly) {
    const countQuery = supabase
      .from('inventory_items')
      .select('id, quantity, reorder_threshold', { count: 'exact', head: false })
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)

    const { data, error } = await countQuery
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    // Supabase count may include rows the filter didn't apply to client-side;
    // compute exact client-side to guarantee correctness for low_stock.
    const count = lowStock
      ? (data ?? []).filter((r) => Number(r.quantity ?? 0) <= Number(r.reorder_threshold ?? 0))
          .length
      : (data ?? []).length
    res.json({ count })
    return
  }

  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('inventory_items')
    .select('*', { count: 'exact' })
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('vertical')
    .eq('id', authed.tenantId)
    .single()

  const currentVertical = tenantRow?.vertical as string | null | undefined

  if (currentVertical) {
    query = query.or(`vertical.eq.${currentVertical},vertical.is.null`)
  }

  if (q) {
    const pat = `%${q}%`
    query = query.or(`name.ilike.${pat},sku.ilike.${pat}`)
  }

  if (locationId) query = query.eq('location_id', locationId)

  query = query.order('name', { ascending: true }).range(from, to)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Apply low_stock filter client-side (PostgREST can't compare two columns directly
  // via `.filter()` in a portable way across Supabase versions).
  let items = data ?? []
  if (lowStock) {
    items = items.filter((r) => Number(r.quantity ?? 0) <= Number(r.reorder_threshold ?? 0))
  }

  res.json({ data: items, total: count ?? 0, page })
})

// ── GET /api/inventory/barcode/:code ─────────────────────────────────────────
// Must be registered before GET /:id so "barcode" is never read as an item id.
router.get(
  '/barcode/:code',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('barcode', req.params['code'])
      .is('deleted_at', null)
      .maybeSingle()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    if (!data) {
      res.status(404).json({ error: 'No item with that barcode' })
      return
    }

    res.json(data)
  }
)

// ── POST /api/inventory ──────────────────────────────────────────────────────
router.post('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const quantityRaw = b['quantity']
  if (typeof quantityRaw !== 'number' || !Number.isFinite(quantityRaw) || quantityRaw < 0) {
    res.status(400).json({ error: 'quantity must be a number >= 0' })
    return
  }

  const unit = typeof b['unit'] === 'string' ? b['unit'] : 'each'
  if (!VALID_UNITS.includes(unit as Unit)) {
    res.status(400).json({ error: `unit must be one of ${VALID_UNITS.join(', ')}` })
    return
  }

  const reorderThreshold =
    typeof b['reorder_threshold'] === 'number' && b['reorder_threshold'] >= 0
      ? b['reorder_threshold']
      : 5
  const unitCost = typeof b['unit_cost'] === 'number' && b['unit_cost'] >= 0 ? b['unit_cost'] : null
  const sku = typeof b['sku'] === 'string' ? b['sku'].trim() || null : null
  const barcode = typeof b['barcode'] === 'string' ? b['barcode'].trim() || null : null
  const supplier = typeof b['supplier'] === 'string' ? b['supplier'].trim() || null : null
  const notes = typeof b['notes'] === 'string' ? b['notes'] : null
  const locationId = typeof b['location_id'] === 'string' ? b['location_id'] : null

  const parentItemId = typeof b['parent_item_id'] === 'string' ? b['parent_item_id'] : null
  const variantLabel = typeof b['variant_label'] === 'string' ? b['variant_label'].trim() : ''

  if (parentItemId) {
    if (!variantLabel) {
      res.status(400).json({ error: 'variant_label is required when parent_item_id is set' })
      return
    }
    const parentErr = await validateParentItem(supabase, authed.tenantId, parentItemId)
    if (parentErr) {
      res.status(400).json({ error: parentErr })
      return
    }
  }

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: authed.tenantId,
      name,
      sku,
      barcode,
      quantity: quantityRaw,
      reorder_threshold: reorderThreshold,
      unit_cost: unitCost,
      unit,
      supplier,
      notes,
      location_id: locationId,
      parent_item_id: parentItemId,
      variant_label: parentItemId ? variantLabel : null,
    })
    .select('*')
    .single()

  if (error) {
    const isDupeBarcode = error.code === '23505' && error.message.includes('barcode')
    res.status(isDupeBarcode ? 409 : 500).json({
      error: isDupeBarcode ? 'That barcode is already assigned to another item' : error.message,
    })
    return
  }

  void logActivity({
    tenantId: authed.tenantId,
    type: 'system',
    body: `Inventory item created: "${name}" (qty ${quantityRaw})`,
    metadata: { item_id: data.id, item_name: name },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json(data)
})

// ── GET /api/inventory/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(data)
})

// ── PUT /api/inventory/:id ───────────────────────────────────────────────────
router.put('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  if (typeof b['name'] === 'string') {
    const trimmed = b['name'].trim()
    if (!trimmed) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    updates['name'] = trimmed
  }
  if (typeof b['sku'] === 'string') updates['sku'] = b['sku'].trim() || null
  if (b['sku'] === null) updates['sku'] = null
  if (typeof b['barcode'] === 'string') updates['barcode'] = b['barcode'].trim() || null
  if (b['barcode'] === null) updates['barcode'] = null

  if (b['quantity'] !== undefined) {
    if (typeof b['quantity'] !== 'number' || !Number.isFinite(b['quantity']) || b['quantity'] < 0) {
      res.status(400).json({ error: 'quantity must be a number >= 0' })
      return
    }
    updates['quantity'] = b['quantity']
  }

  if (b['reorder_threshold'] !== undefined) {
    if (
      typeof b['reorder_threshold'] !== 'number' ||
      !Number.isFinite(b['reorder_threshold']) ||
      b['reorder_threshold'] < 0
    ) {
      res.status(400).json({ error: 'reorder_threshold must be a number >= 0' })
      return
    }
    updates['reorder_threshold'] = b['reorder_threshold']
  }

  if (b['unit_cost'] !== undefined) {
    if (b['unit_cost'] === null) {
      updates['unit_cost'] = null
    } else if (typeof b['unit_cost'] === 'number' && b['unit_cost'] >= 0) {
      updates['unit_cost'] = b['unit_cost']
    } else {
      res.status(400).json({ error: 'unit_cost must be null or a number >= 0' })
      return
    }
  }

  if (typeof b['unit'] === 'string') {
    if (!VALID_UNITS.includes(b['unit'] as Unit)) {
      res.status(400).json({ error: `unit must be one of ${VALID_UNITS.join(', ')}` })
      return
    }
    updates['unit'] = b['unit']
  }

  if (typeof b['supplier'] === 'string') updates['supplier'] = b['supplier'].trim() || null
  if (b['supplier'] === null) updates['supplier'] = null
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null
  if (typeof b['location_id'] === 'string') updates['location_id'] = b['location_id']
  if (b['location_id'] === null) updates['location_id'] = null

  if (b['parent_item_id'] === null) {
    updates['parent_item_id'] = null
    updates['variant_label'] = null
  } else if (typeof b['parent_item_id'] === 'string') {
    const variantLabel = typeof b['variant_label'] === 'string' ? b['variant_label'].trim() : ''
    if (!variantLabel) {
      res.status(400).json({ error: 'variant_label is required when parent_item_id is set' })
      return
    }
    const parentErr = await validateParentItem(
      supabase,
      authed.tenantId,
      b['parent_item_id'],
      req.params['id']
    )
    if (parentErr) {
      res.status(400).json({ error: parentErr })
      return
    }
    updates['parent_item_id'] = b['parent_item_id']
    updates['variant_label'] = variantLabel
  } else if (typeof b['variant_label'] === 'string') {
    updates['variant_label'] = b['variant_label'].trim() || null
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('inventory_items')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error?.code === '23505' && error.message.includes('barcode')) {
    res.status(409).json({ error: 'That barcode is already assigned to another item' })
    return
  }

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(data)
})

// ── DELETE /api/inventory/:id (soft) ─────────────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('inventory_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .select('id')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.json({ success: true })
  }
)

// ── POST /api/inventory/:id/adjust ───────────────────────────────────────────
router.post(
  '/:id/adjust',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const delta = typeof b['delta'] === 'number' ? b['delta'] : NaN
    if (!Number.isFinite(delta) || delta === 0) {
      res.status(400).json({ error: 'delta must be a non-zero number' })
      return
    }
    const reason = typeof b['reason'] === 'string' ? b['reason'].trim() : ''
    if (!reason) {
      res.status(400).json({ error: 'reason is required' })
      return
    }

    const { data: current, error: fetchErr } = await supabase
      .from('inventory_items')
      .select('id, name, quantity')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .single()

    if (fetchErr || !current) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const currentQty = Number(current.quantity ?? 0)
    const raw = currentQty + delta
    const newQty = Math.max(0, raw)
    const clamped = raw < 0

    const { data: updated, error: updateErr } = await supabase
      .from('inventory_items')
      .update({ quantity: newQty, updated_at: new Date().toISOString() })
      .eq('id', current.id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (updateErr || !updated) {
      res.status(500).json({ error: updateErr?.message ?? 'Failed to adjust' })
      return
    }

    const sign = delta > 0 ? '+' : ''
    void logActivity({
      tenantId: authed.tenantId,
      type: 'inventory_adjust',
      body: `Inventory adjusted: ${sign}${delta} ${current.name} (${reason})`,
      metadata: {
        item_id: current.id,
        item_name: current.name,
        delta,
        new_quantity: newQty,
        clamped,
        reason,
      },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json(updated)
  }
)

// ── GET /api/inventory/:id/movements ─────────────────────────────────────────
router.get(
  '/:id/movements',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: item } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!item) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const limit = Math.min(200, Math.max(1, Number(req.query['limit']) || 50))

    const { data, error } = await supabase
      .from('activity_log')
      .select('id, body, metadata, actor_type, actor_id, created_at')
      .eq('tenant_id', authed.tenantId)
      .eq('type', 'inventory_adjust')
      .contains('metadata', { item_id: item.id })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ movements: data ?? [] })
  }
)

// ── GET /api/inventory/:id/variants ──────────────────────────────────────────
router.get(
  '/:id/variants',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: parent } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!parent) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('parent_item_id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .order('variant_label', { ascending: true })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ variants: data ?? [] })
  }
)

// ── GET /api/inventory/:id/kit-components ────────────────────────────────────
router.get(
  '/:id/kit-components',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: kit } = await supabase
      .from('inventory_items')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!kit) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data: components, error } = await supabase
      .from('inventory_kit_components')
      .select('id, component_item_id, quantity')
      .eq('kit_item_id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const componentIds = (components ?? []).map((c) => c.component_item_id as string)
    let itemsById: Record<
      string,
      { id: string; name: string; sku: string | null; quantity: number }
    > = {}
    if (componentIds.length > 0) {
      const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, sku, quantity')
        .in('id', componentIds)
      itemsById = Object.fromEntries((items ?? []).map((i) => [i.id, i]))
    }

    res.json({
      components: (components ?? []).map((c) => ({
        id: c.id,
        component_item_id: c.component_item_id,
        quantity: c.quantity,
        component: itemsById[c.component_item_id as string] ?? null,
      })),
    })
  }
)

// ── PUT /api/inventory/:id/kit-components ────────────────────────────────────
// Full replace (delete-then-reinsert), same pattern as custom_automation_steps.
router.put(
  '/:id/kit-components',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const kitId = req.params['id'] as string
    const b = req.body as Record<string, unknown>

    const { data: kit } = await supabase
      .from('inventory_items')
      .select('id, parent_item_id')
      .eq('id', kitId)
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!kit) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (kit.parent_item_id) {
      res.status(400).json({ error: 'A variant cannot also be a kit' })
      return
    }

    const rawComponents = Array.isArray(b['components']) ? b['components'] : []
    const componentIds = new Set<string>()
    const rows: { component_item_id: string; quantity: number }[] = []

    for (const entry of rawComponents) {
      const e = entry as Record<string, unknown>
      const componentItemId =
        typeof e['component_item_id'] === 'string' ? e['component_item_id'] : ''
      const quantity = typeof e['quantity'] === 'number' ? e['quantity'] : NaN
      if (!componentItemId || !Number.isFinite(quantity) || quantity <= 0) {
        res.status(400).json({
          error: 'Each component needs a component_item_id and a quantity > 0',
        })
        return
      }
      if (componentItemId === kitId) {
        res.status(400).json({ error: 'A kit cannot contain itself as a component' })
        return
      }
      if (componentIds.has(componentItemId)) {
        res.status(400).json({ error: 'Duplicate component in the list' })
        return
      }
      componentIds.add(componentItemId)
      rows.push({ component_item_id: componentItemId, quantity })
    }

    if (componentIds.size > 0) {
      const { data: existingItems } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('tenant_id', authed.tenantId)
        .is('deleted_at', null)
        .in('id', Array.from(componentIds))
      const foundIds = new Set((existingItems ?? []).map((i) => i.id as string))
      const missing = Array.from(componentIds).filter((id) => !foundIds.has(id))
      if (missing.length > 0) {
        res.status(400).json({ error: `Unknown component item(s): ${missing.join(', ')}` })
        return
      }
    }

    await supabase.from('inventory_kit_components').delete().eq('kit_item_id', kitId)

    if (rows.length === 0) {
      res.json({ components: [] })
      return
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('inventory_kit_components')
      .insert(
        rows.map((r) => ({
          tenant_id: authed.tenantId,
          kit_item_id: kitId,
          component_item_id: r.component_item_id,
          quantity: r.quantity,
        }))
      )
      .select('*')

    if (insertErr) {
      res.status(500).json({ error: `Kit components failed to save: ${insertErr.message}` })
      return
    }

    res.json({ components: inserted ?? [] })
  }
)

// ── POST /api/inventory/:id/build ────────────────────────────────────────────
// Builds N of this kit from its components — all-or-nothing. Decrements each
// component by (quantity_per_kit * N), increments the kit's own quantity by
// N, and logs one 'inventory_adjust' activity row per item touched (matching
// the existing per-item movement-history convention — no schema changes
// needed for a kit build to show up in every touched item's own history).
router.post(
  '/:id/build',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const kitId = req.params['id'] as string
    const b = req.body as Record<string, unknown>

    const buildQty = typeof b['quantity'] === 'number' ? b['quantity'] : NaN
    if (!Number.isFinite(buildQty) || buildQty <= 0) {
      res.status(400).json({ error: 'quantity must be a number > 0' })
      return
    }
    const reason = typeof b['reason'] === 'string' ? b['reason'].trim() : 'Kit build'

    const { data: kit } = await supabase
      .from('inventory_items')
      .select('id, name, quantity')
      .eq('id', kitId)
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!kit) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const { data: recipe, error: recipeErr } = await supabase
      .from('inventory_kit_components')
      .select('component_item_id, quantity')
      .eq('kit_item_id', kitId)
      .eq('tenant_id', authed.tenantId)

    if (recipeErr) {
      res.status(500).json({ error: recipeErr.message })
      return
    }
    if (!recipe || recipe.length === 0) {
      res.status(400).json({ error: 'This item has no kit components defined' })
      return
    }

    const componentIds = recipe.map((r) => r.component_item_id as string)
    const { data: componentItems, error: itemsErr } = await supabase
      .from('inventory_items')
      .select('id, name, quantity')
      .in('id', componentIds)
      .eq('tenant_id', authed.tenantId)

    if (itemsErr) {
      res.status(500).json({ error: itemsErr.message })
      return
    }
    const componentsById = Object.fromEntries((componentItems ?? []).map((i) => [i.id, i]))

    const shortages: string[] = []
    for (const r of recipe) {
      const item = componentsById[r.component_item_id as string]
      const needed = (r.quantity as number) * buildQty
      if (!item || Number(item.quantity ?? 0) < needed) {
        shortages.push(
          `${item?.name ?? r.component_item_id} (need ${needed}, have ${Number(item?.quantity ?? 0)})`
        )
      }
    }
    if (shortages.length > 0) {
      res.status(400).json({
        error: `Not enough stock to build ${buildQty}: ${shortages.join('; ')}`,
      })
      return
    }

    for (const r of recipe) {
      const item = componentsById[r.component_item_id as string]
      const needed = (r.quantity as number) * buildQty
      const newQty = Number(item.quantity ?? 0) - needed

      const { error: updErr } = await supabase
        .from('inventory_items')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('tenant_id', authed.tenantId)
      if (updErr) {
        console.error(
          `[inventory] kit-build component update failed for ${item.id}:`,
          updErr.message
        )
        continue
      }

      void logActivity({
        tenantId: authed.tenantId,
        type: 'inventory_adjust',
        body: `Inventory adjusted: -${needed} ${item.name} (used to build ${buildQty} × ${kit.name})`,
        metadata: {
          item_id: item.id,
          item_name: item.name,
          delta: -needed,
          new_quantity: newQty,
          clamped: false,
          reason: `Kit build: ${kit.name}`,
        },
        actorType: 'user',
        actorId: authed.userId,
      })
    }

    const newKitQty = Number(kit.quantity ?? 0) + buildQty
    const { data: updatedKit, error: kitUpdateErr } = await supabase
      .from('inventory_items')
      .update({ quantity: newKitQty, updated_at: new Date().toISOString() })
      .eq('id', kitId)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (kitUpdateErr || !updatedKit) {
      res.status(500).json({ error: kitUpdateErr?.message ?? 'Failed to update kit quantity' })
      return
    }

    void logActivity({
      tenantId: authed.tenantId,
      type: 'inventory_adjust',
      body: `Inventory adjusted: +${buildQty} ${kit.name} (${reason})`,
      metadata: {
        item_id: kit.id,
        item_name: kit.name,
        delta: buildQty,
        new_quantity: newKitQty,
        clamped: false,
        reason,
      },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json(updatedKit)
  }
)

export default router
