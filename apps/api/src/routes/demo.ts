import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS } from '@nuatis/shared'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()
const DEMO_TENANT_ID = '0d9a00b9-ce40-4702-a99c-ed23f11fdb08'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── PUT /api/demo/switch-vertical ────────────────────────────────────────────
router.put('/switch-vertical', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  if (authed.tenantId !== DEMO_TENANT_ID) {
    res.status(403).json({ error: 'Vertical switching is only available for the demo tenant' })
    return
  }

  const vertical = typeof req.body?.vertical === 'string' ? req.body.vertical : ''

  if (!VERTICALS[vertical]) {
    res.status(400).json({ error: `Invalid vertical: ${vertical}` })
    return
  }

  try {
    const supabase = getSupabase()
    const { error } = await supabase.from('tenants').update({ vertical }).eq('id', DEMO_TENANT_ID)

    if (error) {
      console.error(`[demo] switch-vertical error: ${error.message}`)
      res.status(500).json({ error: 'Failed to switch vertical' })
      return
    }

    console.info(`[demo] vertical switched to ${vertical}`)
    res.json({ vertical, label: VERTICALS[vertical]!.label })
  } catch (err) {
    console.error('[demo] switch-vertical error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
