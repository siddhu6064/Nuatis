import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { checkResourceAvailable, getResourceAvailability } from '../lib/resource-availability.js'

const router = Router()

const VALID_RESOURCE_TYPES = ['room', 'station', 'equipment', 'vehicle', 'other'] as const

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/resources/availability ─────────────────────────────────────────
// MUST be registered before /:id to avoid route conflict
router.get('/availability', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { date, resource_ids } = req.query

  if (!date || typeof date !== 'string') {
    res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' })
    return
  }

  if (!resource_ids || typeof resource_ids !== 'string') {
    res.status(400).json({ error: 'resource_ids query param is required (comma-separated UUIDs)' })
    return
  }

  const resourceIds = resource_ids.split(',').filter(Boolean)
  if (resourceIds.length === 0) {
    res.status(400).json({ error: 'resource_ids must contain at least one ID' })
    return
  }

  try {
    const result = await getResourceAvailability({
      tenantId: authed.tenantId,
      resourceIds,
      date,
    })
    res.json({ slots: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── DELETE /api/resources/bookings/:bookingId ────────────────────────────────
// MUST be registered before /:id to avoid route conflict
router.delete(
  '/bookings/:bookingId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const { bookingId } = req.params
    const supabase = getSupabase()

    const { data: booking, error: fetchErr } = await supabase
      .from('resource_bookings')
      .select('id')
      .eq('id', bookingId)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (fetchErr) {
      res.status(500).json({ error: fetchErr.message })
      return
    }
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' })
      return
    }

    const { error: updateErr } = await supabase
      .from('resource_bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)

    if (updateErr) {
      res.status(500).json({ error: updateErr.message })
      return
    }

    res.json({ ok: true })
  }
)

// ── GET /api/resources ───────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { status, resource_type } = req.query

  let query = supabase.from('bookable_resources').select('*').eq('tenant_id', authed.tenantId)

  if (status && typeof status === 'string') {
    query = query.eq('status', status)
  } else {
    query = query.neq('status', 'inactive')
  }

  if (resource_type && typeof resource_type === 'string') {
    query = query.eq('resource_type', resource_type)
  }

  query = query.order('name', { ascending: true })

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ resources: data ?? [] })
})

// ── POST /api/resources ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { name, resource_type, capacity, color, notes, location_id } = req.body as {
    name?: string
    resource_type?: string
    capacity?: number
    color?: string
    notes?: string
    location_id?: string
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: 'name is required' })
    return
  }

  if (!resource_type || !(VALID_RESOURCE_TYPES as readonly string[]).includes(resource_type)) {
    res.status(400).json({
      error: `resource_type must be one of: ${VALID_RESOURCE_TYPES.join(', ')}`,
    })
    return
  }

  const { data, error } = await supabase
    .from('bookable_resources')
    .insert({
      tenant_id: authed.tenantId,
      name: name.trim(),
      resource_type,
      capacity: capacity ?? null,
      color: color ?? null,
      notes: notes ?? null,
      location_id: location_id ?? null,
      status: 'active',
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(data)
})

// ── PUT /api/resources/:id ───────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  // Ownership check
  const { data: existing, error: fetchErr } = await supabase
    .from('bookable_resources')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!existing) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const { name, resource_type, capacity, color, notes, status, location_id } = req.body as {
    name?: string
    resource_type?: string
    capacity?: number
    color?: string
    notes?: string
    status?: string
    location_id?: string
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) updates['name'] = name
  if (resource_type !== undefined) updates['resource_type'] = resource_type
  if (capacity !== undefined) updates['capacity'] = capacity
  if (color !== undefined) updates['color'] = color
  if (notes !== undefined) updates['notes'] = notes
  if (status !== undefined) updates['status'] = status
  if (location_id !== undefined) updates['location_id'] = location_id

  const { data, error } = await supabase
    .from('bookable_resources')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(data)
})

// ── DELETE /api/resources/:id ────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  // Ownership check
  const { data: existing, error: fetchErr } = await supabase
    .from('bookable_resources')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!existing) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  const { error } = await supabase
    .from('bookable_resources')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

// ── GET /api/resources/:id/bookings ─────────────────────────────────────────
router.get('/:id/bookings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { from, to } = req.query

  // Ownership check
  const { data: resource, error: fetchErr } = await supabase
    .from('bookable_resources')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!resource) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  let query = supabase
    .from('resource_bookings')
    .select('*')
    .eq('resource_id', id)
    .neq('status', 'cancelled')

  if (from && typeof from === 'string') {
    query = query.gte('start_time', from)
  }
  if (to && typeof to === 'string') {
    query = query.lte('end_time', to)
  }

  const { data, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ bookings: data ?? [] })
})

// ── POST /api/resources/:id/book ─────────────────────────────────────────────
router.post('/:id/book', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const id = req.params['id'] as string
  const supabase = getSupabase()

  const { start_time, end_time, appointment_id, contact_id, notes } = req.body as {
    start_time?: string
    end_time?: string
    appointment_id?: string
    contact_id?: string
    notes?: string
  }

  if (!start_time || !end_time) {
    res.status(400).json({ error: 'start_time and end_time are required' })
    return
  }

  if (new Date(end_time) <= new Date(start_time)) {
    res.status(400).json({ error: 'end_time must be after start_time' })
    return
  }

  // Ownership check
  const { data: resource, error: fetchErr } = await supabase
    .from('bookable_resources')
    .select('id, name')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message })
    return
  }
  if (!resource) {
    res.status(404).json({ error: 'Resource not found' })
    return
  }

  // Check availability
  const available = await checkResourceAvailable({
    resourceId: id,
    startTime: new Date(start_time),
    endTime: new Date(end_time),
  })

  if (!available) {
    res.status(409).json({
      error: 'Resource already booked for this time',
      conflict: true,
      resource_name: resource.name,
    })
    return
  }

  const { data, error } = await supabase
    .from('resource_bookings')
    .insert({
      tenant_id: authed.tenantId,
      resource_id: id,
      appointment_id: appointment_id ?? null,
      contact_id: contact_id ?? null,
      start_time,
      end_time,
      notes: notes ?? null,
      booked_by: authed.appUserId ?? null,
      status: 'confirmed',
    })
    .select('id')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({
    booking_id: data.id,
    resource_name: resource.name,
    start_time,
    end_time,
  })
})

export default router
