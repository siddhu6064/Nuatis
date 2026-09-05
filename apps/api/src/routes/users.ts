import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, avatar_url, is_active, monthly_expense_limit_cents')
    .eq('tenant_id', authed.tenantId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data ?? [])
})

const ASSIGNABLE_ROLES = ['admin', 'manager', 'staff']

// ── PUT /api/users/:id/role ───────────────────────────────────────────────────
// Owner/admin only. 'owner' is deliberately not assignable here — ownership
// transfer is a separate, more sensitive flow this route doesn't attempt.
router.put(
  '/:id/role',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { role } = req.body as { role?: string }

    if (!role || !ASSIGNABLE_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` })
      return
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.role === 'owner') {
      res.status(400).json({ error: "Cannot change the owner's role" })
      return
    }

    const { data, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', existing.id)
      .select('id, full_name, role')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to update role' })
      return
    }

    res.json(data)
  }
)

// ── PUT /api/users/:id/expense-limit ─────────────────────────────────────────
router.put(
  '/:id/expense-limit',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const cents = b['monthly_expense_limit_cents']
    if (cents !== null && (typeof cents !== 'number' || cents < 0)) {
      res.status(400).json({ error: 'monthly_expense_limit_cents must be a number >= 0, or null' })
      return
    }

    const { data, error } = await supabase
      .from('users')
      .update({ monthly_expense_limit_cents: cents })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('id, full_name, monthly_expense_limit_cents')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.json(data)
  }
)

export default router
