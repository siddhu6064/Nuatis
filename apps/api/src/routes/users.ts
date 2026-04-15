import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

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
