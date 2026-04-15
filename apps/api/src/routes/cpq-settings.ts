import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const DEFAULT_CPQ_SETTINGS = {
  max_discount_pct: 20,
  require_approval_above: 15,
  deposit_pct: 50,
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/cpq/settings ───────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('cpq_settings')
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const settings = {
    ...DEFAULT_CPQ_SETTINGS,
    ...(tenant.cpq_settings as Record<string, number> | null),
  }
  res.json(settings)
})

// ── PUT /api/cpq/settings ───────────────────────────────────────────────────
router.put('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  // Fetch current settings to merge
  const { data: tenant } = await supabase
    .from('tenants')
    .select('cpq_settings')
    .eq('id', authed.tenantId)
    .single()

  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const current = {
    ...DEFAULT_CPQ_SETTINGS,
    ...(tenant.cpq_settings as Record<string, number> | null),
  }
  const updated = { ...current }

  if (typeof b['max_discount_pct'] === 'number') {
    if (b['max_discount_pct'] < 0 || b['max_discount_pct'] > 100) {
      res.status(400).json({ error: 'max_discount_pct must be between 0 and 100' })
      return
    }
    updated.max_discount_pct = b['max_discount_pct']
  }

  if (typeof b['require_approval_above'] === 'number') {
    if (b['require_approval_above'] < 0 || b['require_approval_above'] > 100) {
      res.status(400).json({ error: 'require_approval_above must be between 0 and 100' })
      return
    }
    updated.require_approval_above = b['require_approval_above']
  }

  if (typeof b['deposit_pct'] === 'number') {
    if (b['deposit_pct'] < 0 || b['deposit_pct'] > 100) {
      res.status(400).json({ error: 'deposit_pct must be between 0 and 100' })
      return
    }
    updated.deposit_pct = b['deposit_pct']
  }

  if (updated.require_approval_above > updated.max_discount_pct) {
    res.status(400).json({ error: 'require_approval_above cannot exceed max_discount_pct' })
    return
  }

  const { error } = await supabase
    .from('tenants')
    .update({ cpq_settings: updated })
    .eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[cpq-settings] updated for tenant=${authed.tenantId}`)
  res.json(updated)
})

export default router
