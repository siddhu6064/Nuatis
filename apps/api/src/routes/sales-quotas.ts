import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function normalizePeriodStart(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const match = /^(\d{4})-(\d{2})/.exec(input.trim())
  if (!match) return null
  return `${match[1]}-${match[2]}-01`
}

function currentPeriodStart(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

// ── GET /api/sales-quotas ─────────────────────────────────────────────────────
// Owner/admin/manager — every rep's quota for one month.
router.get(
  '/',
  requireAuth,
  requireRole('owner', 'admin', 'manager'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const periodStart = normalizePeriodStart(req.query['period_start']) ?? currentPeriodStart()

    const { data, error } = await supabase
      .from('sales_quotas')
      .select('id, user_id, period_start, quota_amount')
      .eq('tenant_id', authed.tenantId)
      .eq('period_start', periodStart)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ period_start: periodStart, quotas: data ?? [] })
  }
)

// ── PUT /api/sales-quotas/:userId ─────────────────────────────────────────────
// Owner/admin/manager — set (or clear) one rep's quota for one month.
router.put(
  '/:userId',
  requireAuth,
  requireRole('owner', 'admin', 'manager'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const periodStart = normalizePeriodStart(b['period_start'])
    if (!periodStart) {
      res.status(400).json({ error: 'period_start is required (YYYY-MM or YYYY-MM-DD)' })
      return
    }

    const amount = b['quota_amount']
    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({ error: 'quota_amount must be a number >= 0' })
      return
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', req.params['userId'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (userErr || !user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    const { data, error } = await supabase
      .from('sales_quotas')
      .upsert(
        {
          tenant_id: authed.tenantId,
          user_id: req.params['userId'],
          period_start: periodStart,
          quota_amount: amount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id,period_start' }
      )
      .select('id, user_id, period_start, quota_amount')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to set quota' })
      return
    }

    res.json(data)
  }
)

export default router
