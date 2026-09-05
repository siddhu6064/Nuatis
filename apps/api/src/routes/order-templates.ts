import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'

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

router.use(requireAuth, requireOrders)

interface LineItemInput {
  service_id?: string | null
  description: string
  quantity: number
  unit_price: number
}

function validateLineItems(raw: unknown): LineItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const items: LineItemInput[] = []
  for (const item of raw) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>)['description'] !== 'string' ||
      typeof (item as Record<string, unknown>)['quantity'] !== 'number' ||
      typeof (item as Record<string, unknown>)['unit_price'] !== 'number'
    ) {
      return null
    }
    const i = item as Record<string, unknown>
    items.push({
      service_id: typeof i['service_id'] === 'string' ? i['service_id'] : null,
      description: i['description'] as string,
      quantity: i['quantity'] as number,
      unit_price: i['unit_price'] as number,
    })
  }
  return items
}

// ── GET /api/order-templates ──────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('order_templates')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('name', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── POST /api/order-templates ─────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const lineItems = validateLineItems(b['line_items'])
  if (!lineItems) {
    res.status(400).json({ error: 'At least one valid line item is required' })
    return
  }

  const fulfillmentType = typeof b['fulfillment_type'] === 'string' ? b['fulfillment_type'] : null

  const { data, error } = await supabase
    .from('order_templates')
    .insert({
      tenant_id: authed.tenantId,
      name,
      line_items: lineItems,
      fulfillment_type: fulfillmentType,
      notes: typeof b['notes'] === 'string' ? b['notes'] : null,
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// ── DELETE /api/order-templates/:id ───────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { error } = await supabase
    .from('order_templates')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ deleted: true })
})

export default router
