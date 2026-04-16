import { Router, type Request, type Response, type NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'

const router = Router()

// CPQ module gate for all package routes
router.use(requireAuth)
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'cpq')
  if (!enabled) {
    res.status(403).json({
      error: 'CPQ module is not enabled for your workspace. Enable it in Settings → Modules.',
    })
    return
  }
  next()
})

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface PackageItem {
  service_id: string
  qty: number
}

interface ServiceRow {
  id: string
  name: string
  unit_price: number
  vertical?: string
}

// ── GET /api/packages ───────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const vertical = req.query['vertical'] ? String(req.query['vertical']) : null

  let query = supabase
    .from('service_packages')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (vertical) query = query.eq('vertical', vertical)

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ packages: data ?? [] })
})

// ── GET /api/packages/:id ───────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: pkg, error } = await supabase
    .from('service_packages')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !pkg) {
    res.status(404).json({ error: 'Package not found' })
    return
  }

  // Resolve service names + prices
  const items = pkg.items as PackageItem[]
  const serviceIds = items.map((i) => i.service_id)
  const { data: services } = await supabase
    .from('services')
    .select('id, name, unit_price')
    .in('id', serviceIds)

  const serviceMap = new Map<string, ServiceRow>()
  for (const s of services ?? []) {
    serviceMap.set(s.id, s)
  }

  const resolvedItems = items.map((item) => {
    const svc = serviceMap.get(item.service_id)
    return {
      service_id: item.service_id,
      qty: item.qty,
      service_name: svc?.name ?? 'Unknown',
      unit_price: Number(svc?.unit_price ?? 0),
      line_total: Number((item.qty * Number(svc?.unit_price ?? 0)).toFixed(2)),
    }
  })

  const listPriceTotal = resolvedItems.reduce((sum, i) => sum + i.line_total, 0)
  const savings = Number((listPriceTotal - Number(pkg.bundle_price)).toFixed(2))

  res.json({
    ...pkg,
    items: resolvedItems,
    list_price_total: Number(listPriceTotal.toFixed(2)),
    savings,
  })
})

// ── POST /api/packages ──────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const vertical = typeof b['vertical'] === 'string' ? b['vertical'].trim() : ''
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  const description = typeof b['description'] === 'string' ? b['description'] : null
  const bundlePrice = typeof b['bundle_price'] === 'number' ? b['bundle_price'] : 0
  const items = Array.isArray(b['items']) ? (b['items'] as PackageItem[]) : []

  if (!vertical || !name) {
    res.status(400).json({ error: 'vertical and name are required' })
    return
  }
  if (items.length < 2) {
    res.status(400).json({ error: 'At least 2 services are required in a package' })
    return
  }
  if (bundlePrice <= 0) {
    res.status(400).json({ error: 'bundle_price must be greater than 0' })
    return
  }

  // Validate all service_ids belong to tenant
  const serviceIds = items.map((i) => i.service_id)
  const { data: services } = await supabase
    .from('services')
    .select('id, unit_price')
    .eq('tenant_id', authed.tenantId)
    .in('id', serviceIds)

  if (!services || services.length !== serviceIds.length) {
    res.status(400).json({ error: 'One or more service_ids not found in your catalog' })
    return
  }

  const serviceMap = new Map(services.map((s) => [s.id, Number(s.unit_price)]))
  const listTotal = items.reduce((sum, i) => sum + i.qty * (serviceMap.get(i.service_id) ?? 0), 0)
  const discountPct =
    listTotal > 0 ? Number((((listTotal - bundlePrice) / listTotal) * 100).toFixed(2)) : 0

  const { data, error } = await supabase
    .from('service_packages')
    .insert({
      tenant_id: authed.tenantId,
      vertical,
      name,
      description,
      items,
      bundle_price: bundlePrice,
      bundle_discount_pct: discountPct,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// ── PUT /api/packages/reorder ───────────────────────────────────────────────
// Registered before /:id to avoid Express matching "reorder" as :id param
router.put('/reorder', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const reorderItems = req.body as Array<{ id: string; sort_order: number }>

  if (!Array.isArray(reorderItems)) {
    res.status(400).json({ error: 'Expected array of {id, sort_order}' })
    return
  }

  for (const item of reorderItems) {
    await supabase
      .from('service_packages')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
      .eq('tenant_id', authed.tenantId)
  }

  res.json({ reordered: true })
})

// ── PUT /api/packages/:id ───────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('service_packages')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Package not found' })
    return
  }

  const updates: Record<string, unknown> = {}

  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (typeof b['vertical'] === 'string') updates['vertical'] = b['vertical']
  if (b['description'] !== undefined) updates['description'] = b['description'] || null

  const items = Array.isArray(b['items']) ? (b['items'] as PackageItem[]) : null
  const bundlePrice = typeof b['bundle_price'] === 'number' ? b['bundle_price'] : null

  if (items !== null) {
    if (items.length < 2) {
      res.status(400).json({ error: 'At least 2 services are required in a package' })
      return
    }
    // Validate service_ids
    const serviceIds = items.map((i) => i.service_id)
    const { data: services } = await supabase
      .from('services')
      .select('id, unit_price')
      .eq('tenant_id', authed.tenantId)
      .in('id', serviceIds)

    if (!services || services.length !== serviceIds.length) {
      res.status(400).json({ error: 'One or more service_ids not found in your catalog' })
      return
    }

    updates['items'] = items

    // Recalculate discount
    if (bundlePrice !== null && bundlePrice > 0) {
      const serviceMap = new Map(services.map((s) => [s.id, Number(s.unit_price)]))
      const listTotal = items.reduce(
        (sum, i) => sum + i.qty * (serviceMap.get(i.service_id) ?? 0),
        0
      )
      updates['bundle_price'] = bundlePrice
      updates['bundle_discount_pct'] =
        listTotal > 0 ? Number((((listTotal - bundlePrice) / listTotal) * 100).toFixed(2)) : 0
    }
  } else if (bundlePrice !== null) {
    updates['bundle_price'] = bundlePrice
  }

  const { data, error } = await supabase
    .from('service_packages')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

// ── DELETE /api/packages/:id (soft delete) ──────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { error } = await supabase
    .from('service_packages')
    .update({ is_active: false })
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

export default router
