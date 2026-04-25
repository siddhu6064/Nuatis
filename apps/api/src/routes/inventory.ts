import { Router, type Request, type Response, type NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

const VALID_UNITS = ['each', 'box', 'kg', 'L', 'bag', 'roll', 'other'] as const
type Unit = (typeof VALID_UNITS)[number]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function requireCrm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'crm')
  if (!enabled) {
    res.status(403).json({ error: 'CRM module is not enabled' })
    return
  }
  next()
}

// ── GET /api/inventory ───────────────────────────────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const countOnly = req.query['count'] === 'true'
  const lowStock = req.query['low_stock'] === 'true'
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''

  // Count-only path (used by sidebar low-stock badge polling)
  if (countOnly) {
    let countQuery = supabase
      .from('inventory_items')
      .select('id, quantity, reorder_threshold', { count: 'exact', head: false })
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)

    if (lowStock) {
      // PostgREST filter: quantity <= reorder_threshold
      countQuery = countQuery.filter('quantity', 'lte', 'reorder_threshold')
    }

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

// ── POST /api/inventory ──────────────────────────────────────────────────────
router.post('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
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
  const supplier = typeof b['supplier'] === 'string' ? b['supplier'].trim() || null : null
  const notes = typeof b['notes'] === 'string' ? b['notes'] : null

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      tenant_id: authed.tenantId,
      name,
      sku,
      quantity: quantityRaw,
      reorder_threshold: reorderThreshold,
      unit_cost: unitCost,
      unit,
      supplier,
      notes,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
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
  const supabase = getSupabase()

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
  const supabase = getSupabase()
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
    const supabase = getSupabase()

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
    const supabase = getSupabase()
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
      },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json(updated)
  }
)

export default router
