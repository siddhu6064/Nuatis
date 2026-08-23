import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// GET /api/settings/labs — returns current labs_config for tenant
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('labs_config')
    .eq('id', authed.tenantId)
    .single()
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Not found' })
    return
  }
  res.json({ labs_config: (data.labs_config as Record<string, boolean>) ?? {} })
})

// PUT /api/settings/labs — { key: string, enabled: boolean }
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { key, enabled } = req.body as { key?: string; enabled?: boolean }
  if (!key || typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'key and enabled required' })
    return
  }
  const supabase = getServiceClient()
  // Fetch current config first
  const { data, error: fetchErr } = await supabase
    .from('tenants')
    .select('labs_config')
    .eq('id', authed.tenantId)
    .single()
  if (fetchErr || !data) {
    res.status(500).json({ error: fetchErr?.message ?? 'Not found' })
    return
  }
  const current = (data.labs_config as Record<string, boolean>) ?? {}
  const updated = { ...current, [key]: enabled }
  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ labs_config: updated })
    .eq('id', authed.tenantId)
  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }
  res.json({ ok: true, labs_config: updated })
})

export default router
