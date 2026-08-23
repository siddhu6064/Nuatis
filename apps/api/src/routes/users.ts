import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, avatar_url, is_active')
    .eq('tenant_id', authed.tenantId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data ?? [])
})

export default router
