import { Router, type Request, type Response, type NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { invalidateStaffCache } from '../lib/staff-cache.js'

const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function requireCrm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'crm')
  if (!enabled) {
    res.status(403).json({ error: 'CRM module is not enabled' })
    return
  }
  next()
}

interface ConflictResult {
  conflict: boolean
  conflicting?: {
    id: string
    date: string
    start_time: string
    end_time: string
  }
}

async function checkShiftConflict(
  tenantId: string,
  staffId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeShiftId?: string
): Promise<ConflictResult> {
  const supabase = getSupabase()
  let query = supabase
    .from('shifts')
    .select('id, date, start_time, end_time')
    .eq('tenant_id', tenantId)
    .eq('staff_id', staffId)
    .eq('date', date)
    .lt('start_time', endTime)
    .gt('end_time', startTime)
    .limit(1)

  if (excludeShiftId) query = query.neq('id', excludeShiftId)

  const { data } = await query
  const row = (data ?? [])[0]
  if (!row) return { conflict: false }
  return {
    conflict: true,
    conflicting: {
      id: row.id as string,
      date: row.date as string,
      start_time: row.start_time as string,
      end_time: row.end_time as string,
    },
  }
}

// ── GET /api/staff ───────────────────────────────────────────────────────────
router.get('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const activeParam = typeof req.query['active'] === 'string' ? req.query['active'] : 'true'
  let query = supabase.from('staff_members').select('*').eq('tenant_id', authed.tenantId)

  if (authed.vertical) {
    query = query.or(`vertical.eq.${authed.vertical},vertical.is.null`)
  }

  if (activeParam !== 'all') {
    const active = activeParam !== 'false'
    query = query.eq('is_active', active)
  }

  query = query.order('name', { ascending: true })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [] })
})

// ── POST /api/staff ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  const role = typeof b['role'] === 'string' ? b['role'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!role) {
    res.status(400).json({ error: 'role is required' })
    return
  }

  const payload: Record<string, unknown> = {
    tenant_id: authed.tenantId,
    name,
    role,
    email: typeof b['email'] === 'string' ? b['email'].trim() || null : null,
    phone: typeof b['phone'] === 'string' ? b['phone'].trim() || null : null,
    color_hex: typeof b['color_hex'] === 'string' ? b['color_hex'] : '#6366F1',
    availability:
      b['availability'] && typeof b['availability'] === 'object' ? b['availability'] : {},
    notes: typeof b['notes'] === 'string' ? b['notes'] : null,
  }

  const { data, error } = await supabase.from('staff_members').insert(payload).select('*').single()
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  invalidateStaffCache(authed.tenantId)
  res.status(201).json(data)
})

// ── GET /api/staff/shifts ────────────────────────────────────────────────────
// Tenant-wide shift list for the weekly calendar view.
// Mounted BEFORE /:id so it isn't shadowed.
router.get(
  '/shifts',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const start = typeof req.query['start_date'] === 'string' ? req.query['start_date'] : ''
    const end = typeof req.query['end_date'] === 'string' ? req.query['end_date'] : ''
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      res.status(400).json({ error: 'start_date and end_date (YYYY-MM-DD) are required' })
      return
    }

    const { data, error } = await supabase
      .from('shifts')
      .select('*, staff_members(name, color_hex)')
      .eq('tenant_id', authed.tenantId)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const rows = (data ?? []).map((r) => {
      const staff = r.staff_members as { name?: string; color_hex?: string } | null
      return {
        id: r.id as string,
        tenant_id: r.tenant_id as string,
        staff_id: r.staff_id as string,
        date: r.date as string,
        start_time: r.start_time as string,
        end_time: r.end_time as string,
        notes: (r.notes as string | null) ?? null,
        created_at: r.created_at as string,
        staff_name: staff?.name ?? null,
        staff_color: staff?.color_hex ?? null,
      }
    })

    res.json({ data: rows })
  }
)

// ── GET /api/staff/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const includeInactive = req.query['include_inactive'] === 'true'

  let query = supabase
    .from('staff_members')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)

  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query.single()
  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json(data)
})

// ── PUT /api/staff/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireCrm, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string') {
    const trimmed = b['name'].trim()
    if (!trimmed) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    updates['name'] = trimmed
  }
  if (typeof b['role'] === 'string') {
    const trimmed = b['role'].trim()
    if (!trimmed) {
      res.status(400).json({ error: 'role cannot be empty' })
      return
    }
    updates['role'] = trimmed
  }
  if (typeof b['email'] === 'string') updates['email'] = b['email'].trim() || null
  if (b['email'] === null) updates['email'] = null
  if (typeof b['phone'] === 'string') updates['phone'] = b['phone'].trim() || null
  if (b['phone'] === null) updates['phone'] = null
  if (typeof b['color_hex'] === 'string') updates['color_hex'] = b['color_hex']
  if (typeof b['is_active'] === 'boolean') updates['is_active'] = b['is_active']
  if (b['availability'] && typeof b['availability'] === 'object')
    updates['availability'] = b['availability']
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (b['notes'] === null) updates['notes'] = null

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('staff_members')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  invalidateStaffCache(authed.tenantId)
  res.json(data)
})

// ── DELETE /api/staff/:id (soft — flips is_active=false) ─────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('staff_members')
      .update({ is_active: false })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .eq('is_active', true)
      .select('id')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    invalidateStaffCache(authed.tenantId)
    res.json({ success: true })
  }
)

// ── GET /api/staff/:id/shifts ────────────────────────────────────────────────
router.get(
  '/:id/shifts',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const start = typeof req.query['start_date'] === 'string' ? req.query['start_date'] : null
    const end = typeof req.query['end_date'] === 'string' ? req.query['end_date'] : null

    let query = supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('staff_id', req.params['id'])

    if (start && DATE_RE.test(start)) query = query.gte('date', start)
    if (end && DATE_RE.test(end)) query = query.lte('date', end)

    query = query.order('date', { ascending: true }).order('start_time', { ascending: true })

    const { data, error } = await query
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ data: data ?? [] })
  }
)

function validateShiftBody(
  b: Record<string, unknown>,
  partial: boolean
):
  | { ok: true; date?: string; start_time?: string; end_time?: string; notes?: string | null }
  | { ok: false; error: string } {
  const date = typeof b['date'] === 'string' ? b['date'] : null
  const startTime = typeof b['start_time'] === 'string' ? b['start_time'] : null
  const endTime = typeof b['end_time'] === 'string' ? b['end_time'] : null

  if (!partial) {
    if (!date || !DATE_RE.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' }
    if (!startTime || !TIME_RE.test(startTime))
      return { ok: false, error: 'start_time must be HH:MM' }
    if (!endTime || !TIME_RE.test(endTime)) return { ok: false, error: 'end_time must be HH:MM' }
  } else {
    if (date !== null && !DATE_RE.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' }
    if (startTime !== null && !TIME_RE.test(startTime))
      return { ok: false, error: 'start_time must be HH:MM' }
    if (endTime !== null && !TIME_RE.test(endTime))
      return { ok: false, error: 'end_time must be HH:MM' }
  }

  if (startTime && endTime && !(endTime > startTime)) {
    return { ok: false, error: 'end_time must be after start_time' }
  }

  const notes = typeof b['notes'] === 'string' ? b['notes'] : b['notes'] === null ? null : undefined

  const result: {
    ok: true
    date?: string
    start_time?: string
    end_time?: string
    notes?: string | null
  } = {
    ok: true,
  }
  if (date) result.date = date
  if (startTime) result.start_time = startTime
  if (endTime) result.end_time = endTime
  if (notes !== undefined) result.notes = notes
  return result
}

// ── POST /api/staff/:id/shifts ───────────────────────────────────────────────
router.post(
  '/:id/shifts',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>
    const staffId = req.params['id'] as string

    const v = validateShiftBody(b, false)
    if (!v.ok) {
      res.status(400).json({ error: v.error })
      return
    }

    // Verify staff belongs to tenant
    const { data: staff } = await supabase
      .from('staff_members')
      .select('id, name')
      .eq('id', staffId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!staff) {
      res.status(404).json({ error: 'Staff member not found' })
      return
    }

    const conflict = await checkShiftConflict(
      authed.tenantId,
      staffId,
      v.date as string,
      v.start_time as string,
      v.end_time as string
    )
    if (conflict.conflict && conflict.conflicting) {
      res.status(409).json({
        error: 'shift_conflict',
        message: `${staff.name} already has a shift ${conflict.conflicting.start_time}–${conflict.conflicting.end_time} on this day`,
        conflicting_shift: conflict.conflicting,
      })
      return
    }

    const { data, error } = await supabase
      .from('shifts')
      .insert({
        tenant_id: authed.tenantId,
        staff_id: staffId,
        date: v.date,
        start_time: v.start_time,
        end_time: v.end_time,
        notes: v.notes ?? null,
      })
      .select('*')
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(201).json(data)
  }
)

// ── PUT /api/staff/:id/shifts/:shiftId ───────────────────────────────────────
router.put(
  '/:id/shifts/:shiftId',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>
    const staffId = req.params['id'] as string
    const shiftId = req.params['shiftId'] as string

    const v = validateShiftBody(b, true)
    if (!v.ok) {
      res.status(400).json({ error: v.error })
      return
    }

    const { data: existing } = await supabase
      .from('shifts')
      .select('id, staff_id, date, start_time, end_time, notes')
      .eq('id', shiftId)
      .eq('tenant_id', authed.tenantId)
      .eq('staff_id', staffId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const updates: Record<string, unknown> = {}
    if (v.date) updates['date'] = v.date
    if (v.start_time) updates['start_time'] = v.start_time
    if (v.end_time) updates['end_time'] = v.end_time
    if (v.notes !== undefined) updates['notes'] = v.notes

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' })
      return
    }

    // Conflict check uses the effective new values merged with existing row
    const effDate = (v.date ?? existing.date) as string
    const effStart = (v.start_time ?? existing.start_time) as string
    const effEnd = (v.end_time ?? existing.end_time) as string

    if (!(effEnd > effStart)) {
      res.status(400).json({ error: 'end_time must be after start_time' })
      return
    }

    const conflict = await checkShiftConflict(
      authed.tenantId,
      staffId,
      effDate,
      effStart,
      effEnd,
      shiftId
    )
    if (conflict.conflict && conflict.conflicting) {
      const { data: staff } = await supabase
        .from('staff_members')
        .select('name')
        .eq('id', staffId)
        .eq('tenant_id', authed.tenantId)
        .single()
      res.status(409).json({
        error: 'shift_conflict',
        message: `${staff?.name ?? 'Staff'} already has a shift ${conflict.conflicting.start_time}–${conflict.conflicting.end_time} on this day`,
        conflicting_shift: conflict.conflicting,
      })
      return
    }

    const { data, error } = await supabase
      .from('shifts')
      .update(updates)
      .eq('id', shiftId)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? 'Failed to update' })
      return
    }
    res.json(data)
  }
)

// ── DELETE /api/staff/:id/shifts/:shiftId ────────────────────────────────────
router.delete(
  '/:id/shifts/:shiftId',
  requireAuth,
  requireCrm,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const staffId = req.params['id'] as string
    const shiftId = req.params['shiftId'] as string

    const { data, error } = await supabase
      .from('shifts')
      .delete()
      .eq('id', shiftId)
      .eq('tenant_id', authed.tenantId)
      .eq('staff_id', staffId)
      .select('id')
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({ success: true })
  }
)

export default router
