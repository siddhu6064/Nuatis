import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

async function requireCrm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'crm')
  if (!enabled) {
    res.status(403).json({ error: 'CRM module is not enabled' })
    return
  }
  next()
}

// ── GET /api/time-off — manager view, all staff ──────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const status = typeof req.query['status'] === 'string' ? req.query['status'] : ''

  let query = supabase.from('time_off_requests').select('*').eq('tenant_id', authed.tenantId)

  if (status) query = query.eq('status', status)
  query = query.order('start_date', { ascending: true })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = data ?? []
  // Manual batch-fetch-and-merge, not a nested select — time_off_requests.staff_id
  // doesn't follow the singular-table-name FK convention the mock's join
  // resolver assumes (same class of gap as staff_services earlier this session).
  const staffIds = [...new Set(rows.map((r) => r.staff_id as string))]
  let staffById = new Map<string, { id: string; name: string; color_hex: string }>()
  if (staffIds.length > 0) {
    const { data: staffRows } = await supabase
      .from('staff_members')
      .select('id, name, color_hex')
      .in('id', staffIds)
    staffById = new Map(
      (staffRows ?? []).map((s) => [
        s.id as string,
        { id: s.id as string, name: s.name as string, color_hex: s.color_hex as string },
      ])
    )
  }

  res.json({
    data: rows.map((r) => ({
      ...r,
      staff_members: staffById.get(r.staff_id as string) ?? null,
    })),
  })
})

// Overlapping shifts for this staff member within the requested date range —
// surfaced as a warning so a manager knows to reassign coverage, same
// soft-warn convention as the shift-vs-availability check in staff.ts.
async function findShiftConflicts(
  tenantId: string,
  staffId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ id: string; date: string; start_time: string; end_time: string }>> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('shifts')
    .select('id, date, start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('staff_id', staffId)
    .gte('date', startDate)
    .lte('date', endDate)

  return (data ?? []) as Array<{ id: string; date: string; start_time: string; end_time: string }>
}

// ── POST /api/time-off/:id/approve — owner/admin/manager ─────────────────────
router.post(
  '/:id/approve',
  requireAuth,
  requireRole('owner', 'admin', 'manager'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const { data: existing } = await supabase
      .from('time_off_requests')
      .select('id, staff_id, start_date, end_date, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ error: 'Request is not pending' })
      return
    }

    const note = typeof b['note'] === 'string' ? b['note'] : null

    const { data, error } = await supabase
      .from('time_off_requests')
      .update({
        status: 'approved',
        approved_by: authed.appUserId ?? null,
        approved_at: new Date().toISOString(),
        approval_note: note,
      })
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to approve' })
      return
    }

    const conflicts = await findShiftConflicts(
      authed.tenantId,
      existing.staff_id as string,
      existing.start_date as string,
      existing.end_date as string
    )

    void logActivity({
      tenantId: authed.tenantId,
      type: 'system',
      body: `Time-off request approved (${existing.start_date}–${existing.end_date})`,
      metadata: { time_off_request_id: existing.id },
      actorType: 'user',
      actorId: authed.userId,
    })

    res.json({
      ...data,
      shift_conflicts: conflicts.length > 0 ? conflicts : null,
    })
  }
)

// ── POST /api/time-off/:id/reject — owner/admin/manager ───────────────────────
router.post(
  '/:id/reject',
  requireAuth,
  requireRole('owner', 'admin', 'manager'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const { data: existing } = await supabase
      .from('time_off_requests')
      .select('id, status')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ error: 'Request is not pending' })
      return
    }

    const note = typeof b['note'] === 'string' ? b['note'] : null

    const { data, error } = await supabase
      .from('time_off_requests')
      .update({
        status: 'rejected',
        approved_by: authed.appUserId ?? null,
        approved_at: new Date().toISOString(),
        approval_note: note,
      })
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to reject' })
      return
    }
    res.json(data)
  }
)

export default router
