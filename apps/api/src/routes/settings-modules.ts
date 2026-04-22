import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const VALID_MODULES = [
  'maya',
  'crm',
  'appointments',
  'pipeline',
  'automation',
  'cpq',
  'insights',
  'companies',
  'deals',
]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/settings/modules ───────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('tenants')
    .select('modules')
    .eq('id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({ modules: (data.modules as Record<string, boolean>) ?? {} })
})

// ── PUT /api/settings/modules ───────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  if (authed.role !== 'owner') {
    res.status(403).json({ error: 'Only workspace owners can change module settings' })
    return
  }

  const b = req.body as Record<string, unknown>
  const moduleName = typeof b['module'] === 'string' ? b['module'] : ''
  const enabled = typeof b['enabled'] === 'boolean' ? b['enabled'] : null

  if (!VALID_MODULES.includes(moduleName)) {
    res.status(400).json({ error: `Invalid module. Valid: ${VALID_MODULES.join(', ')}` })
    return
  }
  if (enabled === null) {
    res.status(400).json({ error: 'enabled must be a boolean' })
    return
  }

  // Merge into existing modules jsonb
  const { data: current } = await supabase
    .from('tenants')
    .select('modules')
    .eq('id', authed.tenantId)
    .single()

  const currentModules = (current?.modules as Record<string, boolean>) ?? {}
  const updated = { ...currentModules, [moduleName]: enabled }

  const { error } = await supabase
    .from('tenants')
    .update({ modules: updated })
    .eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[settings-modules] ${moduleName}=${enabled} for tenant=${authed.tenantId}`)
  res.json({ modules: updated })
})

export default router
