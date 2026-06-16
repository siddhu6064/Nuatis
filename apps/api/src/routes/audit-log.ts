import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/audit-log
router.get(
  '/',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
    const offset = (page - 1) * limit

    const action = typeof req.query['action'] === 'string' ? req.query['action'].trim() : null
    const resourceType =
      typeof req.query['resource_type'] === 'string' ? req.query['resource_type'].trim() : null
    const search = typeof req.query['search'] === 'string' ? req.query['search'].trim() : null

    let query = supabase
      .from('audit_log')
      .select(
        'id, created_at, action, resource_type, entity_id, actor_type, actor_id, ip_address, metadata',
        { count: 'exact' }
      )
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (action) query = query.eq('action', action)
    if (resourceType) query = query.eq('resource_type', resourceType)
    if (search) query = query.ilike('entity_id', `%${search}%`)

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      res.status(500).json({ error: 'Failed to fetch audit log' })
      return
    }

    const total = count ?? 0
    res.json({
      items: data ?? [],
      total,
      page,
      pages: Math.ceil(total / limit),
    })
  }
)

export default router
