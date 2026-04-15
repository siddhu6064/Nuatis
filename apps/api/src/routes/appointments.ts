import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { z } from 'zod'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { createEvent, updateEvent, deleteEvent } from '../services/scheduling.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { logActivity } from '../lib/activity.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const CreateAppointmentSchema = z.object({
  contact_id: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().optional().default(''),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  location_id: z.string().uuid().optional(),
  assigned_user_id: z.string().uuid().optional(),
})

const UpdateAppointmentSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  status: z
    .enum(['scheduled', 'confirmed', 'completed', 'no_show', 'canceled', 'rescheduled'])
    .optional(),
})

// ── GET /api/appointments ─────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  await supabase.rpc('set_config', {
    setting: 'app.current_tenant_id',
    value: authed.tenantId,
  })

  const { data, error } = await supabase
    .from('appointments')
    .select('*, contacts(full_name, phone, email)')
    .eq('tenant_id', authed.tenantId)
    .order('start_time', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data })
})

// ── POST /api/appointments ────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const parsed = CreateAppointmentSchema.safeParse(req.body)

  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors })
    return
  }

  const supabase = getSupabase()
  const { contact_id, title, description, start_time, end_time, location_id, assigned_user_id } =
    parsed.data

  // Get location + refresh token for Google Calendar sync
  const { data: location } = await supabase
    .from('locations')
    .select('google_refresh_token, google_calendar_id')
    .eq('tenant_id', authed.tenantId)
    .eq('is_primary', true)
    .single()

  // Get contact email for calendar invite
  const { data: contact } = await supabase
    .from('contacts')
    .select('email, full_name')
    .eq('id', contact_id)
    .eq('tenant_id', authed.tenantId)
    .single()

  let googleEventId: string | null = null

  // Sync to Google Calendar if connected
  if (location?.google_refresh_token && location?.google_calendar_id) {
    try {
      googleEventId = await createEvent({
        refreshToken: location.google_refresh_token,
        calendarId: location.google_calendar_id,
        title,
        description: description ?? '',
        start: start_time,
        end: end_time,
        attendeeEmail: contact?.email ?? undefined,
      })
    } catch (err) {
      console.error('Google Calendar sync failed:', err)
      // Non-fatal — appointment still gets created
    }
  }

  // Insert appointment
  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: authed.tenantId,
      contact_id,
      title,
      description,
      start_time,
      end_time,
      location_id: location_id ?? null,
      assigned_user_id: assigned_user_id ?? null,
      google_event_id: googleEventId,
      status: 'scheduled',
    })
    .select()
    .single()

  if (error) {
    void publishActivityEvent({
      tenant_id: authed.tenantId,
      event_id: contact_id,
      event_type: 'booking.failed',
      payload_json: { severity: 'high', reason: error.message, booking_id: contact_id },
    })
    res.status(500).json({ error: error.message })
    return
  }

  const startFormatted = new Date(start_time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  void logActivity({
    tenantId: authed.tenantId,
    contactId: contact_id,
    type: 'appointment',
    body: `Appointment booked: "${title}" on ${startFormatted}`,
    metadata: { appointment_id: appointment.id },
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json({ data: appointment })
})

// ── PATCH /api/appointments/:id ───────────────────────────────
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const parsed = UpdateAppointmentSchema.safeParse(req.body)

  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors })
    return
  }

  const supabase = getSupabase()

  // Verify appointment belongs to this tenant
  const { data: existing } = await supabase
    .from('appointments')
    .select('google_event_id, tenant_id, contact_id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Appointment not found' })
    return
  }

  // Sync update to Google Calendar
  if (existing.google_event_id) {
    const { data: location } = await supabase
      .from('locations')
      .select('google_refresh_token, google_calendar_id')
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .single()

    if (location?.google_refresh_token && location?.google_calendar_id) {
      try {
        await updateEvent(
          location.google_refresh_token,
          location.google_calendar_id,
          existing.google_event_id,
          {
            title: parsed.data.title,
            description: parsed.data.description,
            start: parsed.data.start_time,
            end: parsed.data.end_time,
          }
        )
      } catch (err) {
        console.error('Google Calendar update failed:', err)
      }
    }
  }

  const { data: appointment, error } = await supabase
    .from('appointments')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Activity logging for status changes
  const appointmentContactId = (appointment as Record<string, unknown>)['contact_id'] as
    | string
    | undefined
  if (parsed.data.status === 'no_show') {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: appointmentContactId ?? undefined,
      type: 'appointment',
      body: `No-show: "${(appointment as Record<string, unknown>)['title'] ?? 'Appointment'}"`,
      metadata: { appointment_id: id },
      actorType: 'system',
    })
  } else if (parsed.data.status === 'completed') {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: appointmentContactId ?? undefined,
      type: 'appointment',
      body: `Appointment completed: "${(appointment as Record<string, unknown>)['title'] ?? 'Appointment'}"`,
      metadata: { appointment_id: id },
      actorType: 'system',
    })
    // Trigger review automation
    void (async () => {
      try {
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('review_automation_enabled, review_delay_minutes')
          .eq('id', authed.tenantId)
          .single()
        if (tenantData?.review_automation_enabled && existing.contact_id) {
          const reviewQueue = new Queue('review-request', { connection: createBullMQConnection() })
          await reviewQueue.add(
            'send-review',
            {
              tenantId: authed.tenantId,
              contactId: existing.contact_id,
              appointmentId: req.params['id'],
            },
            { delay: (tenantData.review_delay_minutes || 120) * 60 * 1000 }
          )
          await reviewQueue.close()
        }
      } catch (err) {
        console.error('[appointments] Failed to enqueue review request:', err)
      }
    })()
  } else if (parsed.data.start_time) {
    const newStart = new Date(parsed.data.start_time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    void logActivity({
      tenantId: authed.tenantId,
      contactId: appointmentContactId ?? undefined,
      type: 'appointment',
      body: `Appointment rescheduled to ${newStart}`,
      metadata: { appointment_id: id },
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  if (parsed.data.status === 'no_show') {
    void (async () => {
      let contactName = 'unknown'
      const contactId = (appointment as Record<string, unknown>)['contact_id']
      if (typeof contactId === 'string') {
        const { data: contact } = await supabase
          .from('contacts')
          .select('full_name')
          .eq('id', contactId)
          .eq('tenant_id', authed.tenantId)
          .single()
        contactName = (contact as { full_name?: string } | null)?.full_name ?? 'unknown'
      }
      await publishActivityEvent({
        tenant_id: authed.tenantId,
        event_id: id ?? '',
        event_type: 'appointment.no_show',
        payload_json: { severity: 'high', appointment_id: id ?? '', contact_name: contactName },
      })
    })()
  }

  res.json({ data: appointment })
})

// ── DELETE /api/appointments/:id ──────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params
  const supabase = getSupabase()

  const { data: existing } = await supabase
    .from('appointments')
    .select('google_event_id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Appointment not found' })
    return
  }

  // Delete from Google Calendar
  if (existing.google_event_id) {
    const { data: location } = await supabase
      .from('locations')
      .select('google_refresh_token, google_calendar_id')
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)
      .single()

    if (location?.google_refresh_token && location?.google_calendar_id) {
      try {
        await deleteEvent(
          location.google_refresh_token,
          location.google_calendar_id,
          existing.google_event_id
        )
      } catch (err) {
        console.error('Google Calendar delete failed:', err)
      }
    }
  }

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(204).send()
})

export default router
