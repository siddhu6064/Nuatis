import { Router, type Request, type Response, type NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { z } from 'zod'
import { getFirstName } from '@nuatis/shared'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import {
  createEvent,
  createEventWithMeet,
  updateEvent,
  deleteEvent,
} from '../services/scheduling.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { logActivity } from '../lib/activity.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { isModuleEnabled } from '../lib/modules.js'
import { checkResourceAvailable } from '../lib/resource-availability.js'
import { sendSms } from '../lib/sms.js'
import { buildConfirmationSms } from '../lib/sms-templates.js'
import { capture } from '../lib/posthog.js'

const router = Router()

// Appointments module gate
async function requireAppointments(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'appointments')
  if (!enabled) {
    res.status(403).json({
      error:
        'Appointments module is not enabled for your workspace. Enable it in Settings → Modules.',
    })
    return
  }
  next()
}

router.use(requireAuth, requireAppointments)

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
  assigned_staff_id: z.string().uuid().nullable().optional(),
  resource_ids: z.array(z.string().uuid()).optional(),
})

const UpdateAppointmentSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  notes: z.string().nullable().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  status: z
    .enum(['scheduled', 'confirmed', 'completed', 'no_show', 'canceled', 'rescheduled'])
    .optional(),
  assigned_staff_id: z.string().uuid().nullable().optional(),
})

// ── GET /api/appointments/report ─────────────────────────────
router.get('/report', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const now = new Date()
  const defaultStart = new Date(now.getTime() - 30 * 86400000).toISOString()
  const startDate =
    typeof req.query['startDate'] === 'string' ? req.query['startDate'] : defaultStart
  const endDate =
    typeof req.query['endDate'] === 'string' ? req.query['endDate'] : now.toISOString()

  const { data: appts } = await supabase
    .from('appointments')
    .select('status, created_by_call, location_id, notes')
    .eq('tenant_id', authed.tenantId)
    .gte('start_time', startDate)
    .lte('start_time', endDate)

  const statusCounts: Record<string, number> = {
    scheduled: 0,
    confirmed: 0,
    completed: 0,
    no_show: 0,
    canceled: 0,
    rescheduled: 0,
    // not in DB enum — always 0 until schema extended
    new: 0,
    invalid: 0,
  }
  const channelCounts = { phone_call: 0, web_booking: 0, sms: 0, manual: 0 }
  const locationCountMap = new Map<string, number>()

  for (const a of appts ?? []) {
    const status = a.status as string
    if (status in statusCounts) statusCounts[status] = (statusCounts[status] ?? 0) + 1
    const notes = (a.notes as string | null) ?? ''
    if (a.created_by_call || notes.toLowerCase().includes('maya')) {
      channelCounts.phone_call++
    } else {
      channelCounts.manual++
    }
    if (a.location_id) {
      const lid = a.location_id as string
      locationCountMap.set(lid, (locationCountMap.get(lid) ?? 0) + 1)
    }
  }

  const sortedLocations = [...locationCountMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  let topCalendars: { calendarId: string; calendarName: string; count: number }[] = []
  if (sortedLocations.length > 0) {
    const { data: locations } = await supabase
      .from('locations')
      .select('id, name')
      .in(
        'id',
        sortedLocations.map(([id]) => id)
      )
    const nameMap = new Map((locations ?? []).map((l) => [l.id as string, l.name as string]))
    topCalendars = sortedLocations.map(([id, count]) => ({
      calendarId: id,
      calendarName: nameMap.get(id) ?? 'Unknown',
      count,
    }))
  }

  const totalAppointments = (appts ?? []).length
  const showed = statusCounts['completed'] ?? 0
  const noShow = statusCounts['no_show'] ?? 0
  const showRate = showed + noShow > 0 ? Math.round((showed / (showed + noShow)) * 100) : 0

  res.json({ statusCounts, channelCounts, topCalendars, totalAppointments, showRate })
})

// ── POST /api/appointments/block ─────────────────────────────
router.post('/block', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const b = req.body as Record<string, unknown>
  const calendarId = typeof b['calendarId'] === 'string' ? b['calendarId'] : null
  const startTime = typeof b['startTime'] === 'string' ? b['startTime'] : null
  const endTime = typeof b['endTime'] === 'string' ? b['endTime'] : null
  const reason = typeof b['reason'] === 'string' && b['reason'].trim() ? b['reason'].trim() : null

  if (!startTime || !endTime) {
    res.status(400).json({ error: 'startTime and endTime required' })
    return
  }
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ error: 'Invalid date format' })
    return
  }
  if (end <= start) {
    res.status(400).json({ error: 'endTime must be after startTime' })
    return
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: authed.tenantId,
      is_blocked: true,
      block_reason: reason,
      title: reason ?? 'Blocked',
      start_time: startTime,
      end_time: endTime,
      location_id: calendarId ?? null,
      status: 'scheduled',
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  res.status(201).json({ data })
})

// ── GET /api/appointments ─────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('appointments')
    .select(
      '*, contacts(full_name, phone, email), staff_members!appointments_assigned_staff_id_fkey(id, name, color_hex)'
    )
    .eq('tenant_id', authed.tenantId)
    .order('start_time', { ascending: true })

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
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
  const {
    contact_id,
    title,
    description,
    start_time,
    end_time,
    location_id,
    assigned_user_id,
    assigned_staff_id,
    resource_ids,
  } = parsed.data

  // Get location + refresh token for Google Calendar sync + video conferencing setting
  const { data: location } = await supabase
    .from('locations')
    .select('google_refresh_token, google_calendar_id, video_conferencing_enabled')
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

  const videoEnabled = !!(location as Record<string, unknown> | null)?.[
    'video_conferencing_enabled'
  ]
  let googleEventId: string | null = null
  let videoLink: string | null = null
  let videoProvider: string | null = null

  // Sync to Google Calendar if connected
  if (location?.google_refresh_token && location?.google_calendar_id) {
    try {
      if (videoEnabled) {
        const { eventId, meetLink } = await createEventWithMeet({
          refreshToken: location.google_refresh_token,
          calendarId: location.google_calendar_id,
          title,
          description: description ?? '',
          start: start_time,
          end: end_time,
          attendeeEmail: contact?.email ?? undefined,
          requestId: `${authed.tenantId}-${Date.now()}`,
        })
        googleEventId = eventId
        videoLink = meetLink
        videoProvider = 'google_meet'
      } else {
        googleEventId = await createEvent({
          refreshToken: location.google_refresh_token,
          calendarId: location.google_calendar_id,
          title,
          description: description ?? '',
          start: start_time,
          end: end_time,
          attendeeEmail: contact?.email ?? undefined,
        })
      }
    } catch (err) {
      console.error('Google Calendar sync failed:', err)
      // Non-fatal — appointment still gets created
    }
  }

  // Resource availability check
  if (resource_ids && resource_ids.length > 0) {
    const startDate = new Date(start_time)
    const endDate = new Date(end_time)
    for (const resourceId of resource_ids) {
      const available = await checkResourceAvailable({
        resourceId,
        startTime: startDate,
        endTime: endDate,
      })
      if (!available) {
        // Fetch resource name for error message
        const { data: resource } = await supabase
          .from('bookable_resources')
          .select('name')
          .eq('id', resourceId)
          .eq('tenant_id', authed.tenantId)
          .maybeSingle<{ name: string }>()
        res.status(409).json({
          error: 'Resource already booked for this time',
          conflict: true,
          resource_name: resource?.name ?? 'Unknown resource',
        })
        return
      }
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
      assigned_staff_id: assigned_staff_id ?? null,
      google_event_id: googleEventId,
      video_link: videoLink,
      video_provider: videoProvider,
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
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  // Activation funnel: appointment booked. distinctId = acting user's appUserId
  // when present, else tenant. This route is the manual/admin booking path.
  // Fire-and-forget — never blocks the response.
  capture(authed.appUserId ?? `tenant:${authed.tenantId}`, 'appointment_created', {
    tenant_id: authed.tenantId,
    channel: 'manual',
  })

  // Book resources for this appointment
  if (resource_ids && resource_ids.length > 0 && appointment?.id) {
    const appointmentId = appointment.id as string
    for (const resourceId of resource_ids) {
      await supabase.from('resource_bookings').insert({
        tenant_id: authed.tenantId,
        resource_id: resourceId,
        appointment_id: appointmentId,
        contact_id,
        start_time,
        end_time,
        booked_by: authed.appUserId ?? null,
        status: 'confirmed',
      })
    }
  }

  // Fallback: video enabled but no Google Calendar connection
  if (videoEnabled && !videoLink && appointment?.id) {
    const aid = appointment.id as string
    const fallbackLink = `https://meet.google.com/${aid.slice(0, 3)}-${aid.slice(3, 7)}-${aid.slice(7, 11)}`
    await supabase
      .from('appointments')
      .update({ video_link: fallbackLink, video_provider: 'manual' })
      .eq('id', aid)
    ;(appointment as Record<string, unknown>)['video_link'] = fallbackLink
    ;(appointment as Record<string, unknown>)['video_provider'] = 'manual'
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

  // Fire-and-forget confirmation SMS — never blocks the response or throws
  void (async () => {
    try {
      // Empty/missing name → '' (≡ null downstream: buildConfirmationSms trims to null)
      const firstName = getFirstName(contact?.full_name as string | undefined, '')

      const [contactPhone, locationSms, tenantSms] = await Promise.all([
        supabase
          .from('contacts')
          .select('phone')
          .eq('id', contact_id)
          .eq('tenant_id', authed.tenantId)
          .single(),
        supabase
          .from('locations')
          .select('telnyx_number')
          .eq('tenant_id', authed.tenantId)
          .eq('is_primary', true)
          .maybeSingle(),
        supabase.from('tenants').select('name, vertical').eq('id', authed.tenantId).single(),
      ])

      const phone = contactPhone.data?.phone as string | undefined
      const telnyxNumber = locationSms.data?.telnyx_number as string | undefined
      const businessName = (tenantSms.data?.name as string | undefined) ?? 'your business'
      const vertical = (tenantSms.data?.vertical as string | undefined) ?? 'sales_crm'

      if (!phone || !telnyxNumber) return

      const dt = new Date(start_time).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })

      const smsText = buildConfirmationSms({
        contactName: firstName,
        businessName,
        appointmentDateTime: dt,
        vertical,
      })

      const { success } = await sendSms(telnyxNumber, phone, smsText, {
        contactId: contact_id,
        tenantId: authed.tenantId,
      })

      if (success) {
        console.info(
          `[appointments] confirmation SMS sent: contact=${contact_id} appt=${String(appointment.id)}`
        )
      }
    } catch (err) {
      console.warn('[appointments] confirmation SMS failed (non-fatal):', err)
    }
  })()

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
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  // Cancel resource bookings when appointment is cancelled
  if (parsed.data.status === 'canceled') {
    await supabase
      .from('resource_bookings')
      .update({ status: 'cancelled' })
      .eq('appointment_id', id)
      .eq('tenant_id', authed.tenantId)
      .neq('status', 'cancelled')
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
          const reviewQueue = new Queue('review-request', {
            connection: createBullMQConnection(),
            skipVersionCheck: true,
          })
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

  // Cancel resource bookings before deleting appointment
  await supabase
    .from('resource_bookings')
    .update({ status: 'cancelled' })
    .eq('appointment_id', id)
    .eq('tenant_id', authed.tenantId)
    .neq('status', 'cancelled')

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: 'Database operation failed' })
    return
  }

  res.status(204).send()
})

export default router
