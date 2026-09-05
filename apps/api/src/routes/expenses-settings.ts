import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/settings/expenses ───────────────────────────────────────────────
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
  const threshold = settings['expenses_require_approval_above']
  res.json({
    expenses_require_approval_above: typeof threshold === 'number' ? threshold : null,
  })
})

// ── PATCH /api/settings/expenses ─────────────────────────────────────────────
router.patch('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const raw = b['expenses_require_approval_above']
  if (raw !== null && (typeof raw !== 'number' || raw < 0)) {
    res
      .status(400)
      .json({ error: 'expenses_require_approval_above must be a number >= 0, or null to disable' })
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
  const merged = { ...existing, expenses_require_approval_above: raw }

  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ settings: merged })
    .eq('id', authed.tenantId)

  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }

  res.json({ expenses_require_approval_above: raw })
})

export default router
