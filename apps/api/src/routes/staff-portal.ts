/**
 * Staff self-service endpoints — a staff-role login's ONLY reachable API
 * surface (enforced in lib/auth.ts's requireAuth via the portalScope JWT
 * claim, not by this file's own gating alone). Every route here scopes
 * strictly to the caller's own staff_members row: own shifts, own assigned
 * appointments (read-only), own time clock, own pay rate. No contacts, no
 * other staff, no tenant settings.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import { notifyOwner } from '../lib/notifications.js'
import { DATE_RE } from './staff-logic.js'

const router = Router()
router.use(requireAuth, requireRole('staff'))

interface StaffScopedRequest extends AuthenticatedRequest {
  staffId: string
  staffName: string
}

/** Resolves the caller's own staff_members.id from their linked user_id. */
async function requireStaffLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  if (!authed.appUserId) {
    res.status(403).json({ error: 'No staff profile linked to this login' })
    return
  }

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('staff_members')
    .select('id, name')
    .eq('tenant_id', authed.tenantId)
    .eq('user_id', authed.appUserId)
    .single()

  if (!data) {
    res.status(403).json({ error: 'No staff profile linked to this login' })
    return
  }

  ;(req as StaffScopedRequest).staffId = data.id as string
  ;(req as StaffScopedRequest).staffName = (data.name as string) || 'A staff member'
  next()
}

router.use(requireStaffLink)

// ── GET /api/staff-portal/me ─────────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('staff_members')
    .select('id, name, role, email, phone, color_hex, pay_type, hourly_rate_cents, salary_cents')
    .eq('id', authed.staffId)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json(data)
})

// ── GET /api/staff-portal/shifts ─────────────────────────────────────────────
router.get('/shifts', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const start = typeof req.query['start_date'] === 'string' ? req.query['start_date'] : null
  const end = typeof req.query['end_date'] === 'string' ? req.query['end_date'] : null

  let query = supabase
    .from('shifts')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('staff_id', authed.staffId)

  if (start && DATE_RE.test(start)) query = query.gte('date', start)
  if (end && DATE_RE.test(end)) query = query.lte('date', end)

  query = query.order('date', { ascending: true }).order('start_time', { ascending: true })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── GET /api/staff-portal/appointments ───────────────────────────────────────
// Read-only. No write endpoints exist on this router for appointments.
router.get('/appointments', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('appointments')
    .select('*, contacts(full_name, phone, email)')
    .eq('tenant_id', authed.tenantId)
    .eq('assigned_staff_id', authed.staffId)
    .order('start_time', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── GET /api/staff-portal/timesheet ──────────────────────────────────────────
router.get('/timesheet', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('staff_id', authed.staffId)
    .order('clock_in_at', { ascending: false })
    .limit(200)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── POST /api/staff-portal/clock-in ──────────────────────────────────────────
router.post('/clock-in', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const { data: open } = await supabase
    .from('time_entries')
    .select('id')
    .eq('tenant_id', authed.tenantId)
    .eq('staff_id', authed.staffId)
    .is('clock_out_at', null)
    .maybeSingle()

  if (open) {
    res.status(409).json({ error: 'Already clocked in' })
    return
  }

  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      tenant_id: authed.tenantId,
      staff_id: authed.staffId,
      clock_in_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json(data)
})

// ── POST /api/staff-portal/clock-out ─────────────────────────────────────────
router.post('/clock-out', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const { data: open } = await supabase
    .from('time_entries')
    .select('id')
    .eq('tenant_id', authed.tenantId)
    .eq('staff_id', authed.staffId)
    .is('clock_out_at', null)
    .maybeSingle()

  if (!open) {
    res.status(409).json({ error: 'Not currently clocked in' })
    return
  }

  const { data, error } = await supabase
    .from('time_entries')
    .update({
      clock_out_at: new Date().toISOString(),
      notes: typeof b['notes'] === 'string' ? b['notes'] : null,
    })
    .eq('id', open.id)
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to clock out' })
    return
  }
  res.json(data)
})

// ── GET /api/staff-portal/time-off ───────────────────────────────────────────
router.get('/time-off', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('staff_id', authed.staffId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── POST /api/staff-portal/time-off ──────────────────────────────────────────
router.post('/time-off', async (req: Request, res: Response): Promise<void> => {
  const authed = req as StaffScopedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const startDate = typeof b['start_date'] === 'string' ? b['start_date'] : ''
  const endDate = typeof b['end_date'] === 'string' ? b['end_date'] : ''
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    res.status(400).json({ error: 'start_date and end_date (YYYY-MM-DD) are required' })
    return
  }
  if (endDate < startDate) {
    res.status(400).json({ error: 'end_date must be on or after start_date' })
    return
  }

  const { data, error } = await supabase
    .from('time_off_requests')
    .insert({
      tenant_id: authed.tenantId,
      staff_id: authed.staffId,
      start_date: startDate,
      end_date: endDate,
      reason: typeof b['reason'] === 'string' ? b['reason'].trim() || null : null,
      status: 'pending',
    })
    .select('*')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  void notifyOwner(authed.tenantId, 'time_off_requested', {
    pushTitle: 'Time off requested',
    pushBody: `${authed.staffName} requested ${startDate} to ${endDate}.`,
    pushUrl: '/staff',
  })

  res.status(201).json(data)
})

export default router
