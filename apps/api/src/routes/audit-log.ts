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

// GET /api/audit-log
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
  const offset = Math.max(0, parseInt(String(req.query['offset'] ?? '0'), 10) || 0)

  const { data, error } = await supabase
    .from('audit_log')
    .select(
      'id, created_at, action, resource_type, entity_id, actor_type, actor_id, ip_address, metadata'
    )
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    res.status(500).json({ error: 'Failed to fetch audit log' })
    return
  }

  res.json(data)
})

export default router
