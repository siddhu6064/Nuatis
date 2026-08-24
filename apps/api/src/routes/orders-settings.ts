import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/settings/orders ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', authed.tenantId)
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const settings = (data?.settings as Record<string, unknown> | null) ?? {}
  res.json({
    orders_auto_deduct_inventory: Boolean(settings['orders_auto_deduct_inventory'] ?? false),
  })
})

// ── PATCH /api/settings/orders ───────────────────────────────────────────────
router.patch('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  if (typeof b['orders_auto_deduct_inventory'] !== 'boolean') {
    res.status(400).json({ error: 'orders_auto_deduct_inventory must be a boolean' })
    return
  }

  const { data: current, error: fetchErr } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', authed.tenantId)
    .single()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }

  const existing = (current?.settings as Record<string, unknown> | null) ?? {}
  const merged = { ...existing, orders_auto_deduct_inventory: b['orders_auto_deduct_inventory'] }

  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ settings: merged })
    .eq('id', authed.tenantId)

  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }

  res.json({ orders_auto_deduct_inventory: b['orders_auto_deduct_inventory'] })
})

export default router
