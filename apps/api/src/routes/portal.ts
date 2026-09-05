import { randomBytes } from 'crypto'
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { authLimiter } from '../middleware/rate-limit.js'
import { buildPortalMagicLinkEmail, buildPortalInviteEmail } from '../lib/email-templates/portal.js'
import { generateCustomerReferralCode } from '../lib/customer-referral.js'
import { getFirstName } from '@nuatis/shared'
import {
  createContactSetupIntent,
  removeContactPaymentMethod,
} from '../lib/contact-payment-methods.js'
import {
  getTenantCalendarCredentials,
  getAvailableSlotsForDate,
  isSlotAvailable,
  createCalendarEvent,
} from '../lib/booking-availability.js'
import { logActivity } from '../lib/activity.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import {
  type SelfServiceAppointment,
  minNoticeHours,
  canModifyAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from '../lib/appointment-self-service.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

// Scoped to the portal token's own contact_id+tenant_id — unlike
// booking-manage.ts's token-only lookup, a portal session already
// authenticates the contact, so this just adds the ownership filter rather
// than needing its own unguessable-token trust model.
async function loadPortalAppointment(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  contactId: string,
  appointmentId: string
): Promise<SelfServiceAppointment | null> {
  const { data } = await supabase
    .from('appointments')
    .select('id, tenant_id, contact_id, title, start_time, end_time, status')
    .eq('id', appointmentId)
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .maybeSingle()
  return (data as SelfServiceAppointment | null) ?? null
}

async function resolvePortalToken(
  supabase: ReturnType<typeof getServiceClient>,
  token: unknown
): Promise<{ contactId: string; tenantId: string } | null> {
  if (!token || typeof token !== 'string') return null
  const { data: access } = await supabase
    .from('portal_access')
    .select('contact_id, tenant_id, expires_at')
    .eq('access_token', token)
    .maybeSingle()
  if (!access) return null
  if (access.expires_at && new Date(access.expires_at) < new Date()) return null
  return { contactId: access.contact_id as string, tenantId: access.tenant_id as string }
}

const router = Router()

// ── PUBLIC ROUTES (no auth) ──────────────────────────────────────────────────

// GET /api/portal/verify?token=
router.get('/verify', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query
  if (!token || typeof token !== 'string') {
    res.status(400).json({ valid: false, error: 'Token required' })
    return
  }

  const supabase = getServiceClient()

  const { data: access } = await supabase
    .from('portal_access')
    .select(
      'contact_id, tenant_id, email, expires_at, contacts(full_name), tenants(name, portal_slug)'
    )
    .eq('access_token', token)
    .maybeSingle()

  if (!access) {
    res.json({ valid: false })
    return
  }

  if (access.expires_at && new Date(access.expires_at) < new Date()) {
    res.json({ valid: false })
    return
  }

  // UPDATE last_accessed_at
  await supabase
    .from('portal_access')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('access_token', token)

  const contact = access.contacts as unknown as { full_name: string | null } | null
  const tenant = access.tenants as unknown as {
    name: string | null
    portal_slug: string | null
  } | null

  res.json({
    valid: true,
    contact_id: access.contact_id,
    tenant_id: access.tenant_id,
    contact_name: contact?.full_name ?? null,
    business_name: tenant?.name ?? null,
    portal_slug: tenant?.portal_slug ?? null,
  })
})

// GET /api/portal/data?token=
router.get('/data', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query
  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Token required' })
    return
  }

  const supabase = getServiceClient()

  // Verify token
  const { data: access } = await supabase
    .from('portal_access')
    .select('contact_id, tenant_id, expires_at')
    .eq('access_token', token)
    .maybeSingle()

  if (!access || (access.expires_at && new Date(access.expires_at) < new Date())) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const { contact_id, tenant_id } = access

  // Fetch contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('full_name, email, phone, default_payment_method_type, default_payment_method_last4')
    .eq('id', contact_id)
    .eq('tenant_id', tenant_id)
    .single()

  // Fetch appointments (upcoming + last 5 past)
  // NOTE: appointments' real columns are start_time/title, not scheduled_at/
  // service_name — this previously selected nonexistent columns and silently
  // returned an empty array on every request (Supabase errors are swallowed
  // by the bare `const { data }` destructure below).
  const now = new Date().toISOString()
  const { data: upcomingAppts } = await supabase
    .from('appointments')
    .select('id, start_time, title, status, location_id')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .gte('start_time', now)
    .order('start_time', { ascending: true })

  const { data: pastAppts } = await supabase
    .from('appointments')
    .select('id, start_time, title, status, location_id')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .lt('start_time', now)
    .order('start_time', { ascending: false })
    .limit(5)

  // Fetch quotes
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_number, description, total, status, created_at, public_token')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .in('status', ['accepted', 'sent'])
    .order('created_at', { ascending: false })
    .limit(10)

  // Fetch invoices — share_token lets the portal link straight to the
  // existing public pay flow (/invoices/public/[token]) instead of leaving
  // an unpaid balance with no action.
  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, balance_due, status, due_date, created_at, share_token')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .in('status', ['sent', 'due', 'overdue', 'received'])
    .order('created_at', { ascending: false })
    .limit(10)

  // Customer referrals — only surfaced when the tenant has the program on.
  let referral: {
    code: string
    referral_url: string
    clicks: number
    reward_cents: number
    referred_reward_cents: number
    rewards: Array<{ contact_name: string | null; status: string; issued_at: string | null }>
  } | null = null

  const { data: referralSettings } = await supabase
    .from('tenants')
    .select(
      'customer_referral_program_enabled, customer_referral_reward_cents, customer_referral_referred_reward_cents'
    )
    .eq('id', tenant_id)
    .maybeSingle()

  if (referralSettings?.customer_referral_program_enabled) {
    const firstName = getFirstName(contact?.full_name, '')
    const code = await generateCustomerReferralCode(tenant_id, contact_id, firstName)
    const { data: codeRow } = await supabase
      .from('contact_referral_codes')
      .select('clicks')
      .eq('tenant_id', tenant_id)
      .eq('contact_id', contact_id)
      .maybeSingle()

    const { data: rewardRows } = await supabase
      .from('customer_referral_rewards')
      .select('status, issued_at, contacts:referred_contact_id(full_name)')
      .eq('tenant_id', tenant_id)
      .eq('referrer_contact_id', contact_id)
      .order('created_at', { ascending: false })

    const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
    referral = {
      code,
      referral_url: `${webUrl}/refer/${code}`,
      clicks: (codeRow?.clicks as number | null) ?? 0,
      reward_cents: (referralSettings.customer_referral_reward_cents as number | null) ?? 0,
      referred_reward_cents:
        (referralSettings.customer_referral_referred_reward_cents as number | null) ?? 0,
      rewards: (rewardRows ?? []).map((r) => {
        const rel = r.contacts as unknown
        const row = Array.isArray(rel)
          ? (rel[0] as { full_name?: string } | undefined)
          : (rel as { full_name?: string } | null)
        return {
          contact_name: row?.full_name ?? null,
          status: r.status as string,
          issued_at: r.issued_at as string | null,
        }
      }),
    }
  }

  // Documents — reuses the staff-uploaded contact_attachments store (same
  // bucket/table attachments.ts already writes to), read-only for the portal.
  const { data: attachmentRows } = await supabase
    .from('contact_attachments')
    .select('id, filename, original_filename, file_type, file_size, storage_path, created_at')
    .eq('contact_id', contact_id)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })

  const documents = await Promise.all(
    (attachmentRows ?? []).map(async (a) => {
      const { data: urlData } = await supabase.storage
        .from('contact-attachments')
        .createSignedUrl(a.storage_path as string, 3600)
      return {
        id: a.id,
        filename: a.original_filename ?? a.filename,
        file_type: a.file_type,
        file_size: a.file_size,
        created_at: a.created_at,
        signed_url: urlData?.signedUrl ?? null,
      }
    })
  )

  res.json({
    contact: contact ?? null,
    appointments: {
      upcoming: upcomingAppts ?? [],
      past: pastAppts ?? [],
    },
    quotes: quotes ?? [],
    invoices: invoices ?? [],
    documents,
    referral,
    paymentMethod: contact?.default_payment_method_type
      ? {
          type: contact.default_payment_method_type as string,
          last4: contact.default_payment_method_last4 as string | null,
        }
      : null,
  })
})

// POST /api/portal/payment-method/setup-intent?token=
router.post('/payment-method/setup-intent', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select(
      'id, tenant_id, full_name, email, stripe_customer_id, default_payment_method_id, stripe_connect_account_id'
    )
    .eq('id', resolved.contactId)
    .eq('tenant_id', resolved.tenantId)
    .single()

  if (!contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  try {
    const result = await createContactSetupIntent(supabase, contact)
    res.json({ clientSecret: result.clientSecret })
  } catch (err) {
    console.error('[portal] setup-intent error:', err)
    res.status(500).json({ error: 'Failed to start payment method setup' })
  }
})

// DELETE /api/portal/payment-method?token=
router.delete('/payment-method', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  await removeContactPaymentMethod(supabase, resolved.tenantId, resolved.contactId)
  res.json({ removed: true })
})

// ── Book a brand-new appointment (contact already known via the portal
// token — no find-or-create-contact, no intake form, no lead-score/SMS
// confirmation dance; those are new-customer-acquisition concerns the public
// booking page owns, not a returning portal customer). Reuses the tenant's
// own curated booking_services list and the same calendar-availability
// helpers the public page and reschedule flow already use. ──────────────────

// GET /api/portal/booking/services?token=
router.get('/booking/services', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('booking_services')
    .eq('id', resolved.tenantId)
    .maybeSingle()

  const bookingServiceIds: string[] = (tenant?.booking_services as string[] | null) ?? []
  if (bookingServiceIds.length === 0) {
    res.json({ services: [], staffByService: {} })
    return
  }

  const { data: servicesData } = await supabase
    .from('services')
    .select('id, name, description, duration_minutes, unit_price')
    .in('id', bookingServiceIds)
    .eq('is_active', true)
    .eq('tenant_id', resolved.tenantId)

  const services = servicesData ?? []

  // Manual batch-fetch-and-merge — staff_services.staff_id doesn't follow
  // the singular-table-name FK convention a nested select would need.
  const staffByService: Record<string, { id: string; name: string; color_hex: string }[]> = {}
  if (services.length > 0) {
    const { data: mappings } = await supabase
      .from('staff_services')
      .select('service_id, staff_id')
      .eq('tenant_id', resolved.tenantId)
      .in(
        'service_id',
        services.map((s) => s.id as string)
      )

    const staffIds = [...new Set((mappings ?? []).map((m) => m.staff_id as string))]
    if (staffIds.length > 0) {
      const { data: staffRows } = await supabase
        .from('staff_members')
        .select('id, name, color_hex')
        .in('id', staffIds)
      const staffById = Object.fromEntries((staffRows ?? []).map((s) => [s.id as string, s]))

      for (const m of mappings ?? []) {
        const serviceId = m.service_id as string
        const staffInfo = staffById[m.staff_id as string]
        if (!staffInfo) continue
        if (!staffByService[serviceId]) staffByService[serviceId] = []
        staffByService[serviceId].push({
          id: staffInfo.id as string,
          name: staffInfo.name as string,
          color_hex: staffInfo.color_hex as string,
        })
      }
    }
  }

  res.json({ services, staffByService })
})

// GET /api/portal/booking/availability?token=&serviceId=&date=&staffId=
router.get('/booking/availability', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const serviceId = typeof req.query['serviceId'] === 'string' ? req.query['serviceId'] : ''
  const date = typeof req.query['date'] === 'string' ? req.query['date'] : ''
  const staffId = typeof req.query['staffId'] === 'string' ? req.query['staffId'] : ''
  if (!serviceId || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'serviceId and date (YYYY-MM-DD) are required' })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('booking_buffer_minutes')
    .eq('id', resolved.tenantId)
    .maybeSingle()
  const bufferMinutes: number = (tenant?.booking_buffer_minutes as number | null) ?? 15

  const { data: service } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('tenant_id', resolved.tenantId)
    .eq('is_active', true)
    .maybeSingle()
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  const durationMinutes: number = (service.duration_minutes as number | null) ?? 60

  let staffFilter: string | undefined
  if (staffId) {
    const { data: mapping } = await supabase
      .from('staff_services')
      .select('id')
      .eq('tenant_id', resolved.tenantId)
      .eq('service_id', serviceId)
      .eq('staff_id', staffId)
      .maybeSingle()
    if (mapping) staffFilter = staffId
  }

  const creds = await getTenantCalendarCredentials(resolved.tenantId)
  if (!creds) {
    res.json({ date, slots: [] })
    return
  }

  const { slots } = await getAvailableSlotsForDate(
    creds,
    date,
    durationMinutes,
    bufferMinutes,
    staffFilter
  )
  res.json({ date, slots })
})

// POST /api/portal/booking/confirm?token=
router.post('/booking/confirm', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const b = req.body as Record<string, unknown>
  const serviceId = typeof b['serviceId'] === 'string' ? b['serviceId'] : ''
  const date = typeof b['date'] === 'string' ? b['date'] : ''
  const startTime = typeof b['startTime'] === 'string' ? b['startTime'] : ''
  const staffId = typeof b['staffId'] === 'string' ? b['staffId'] : ''
  const notes = typeof b['notes'] === 'string' ? b['notes'] : ''

  if (!serviceId || !DATE_RE.test(date) || !TIME_RE.test(startTime)) {
    res
      .status(400)
      .json({ error: 'serviceId, date (YYYY-MM-DD), and startTime (HH:MM) are required' })
    return
  }

  const { data: service } = await supabase
    .from('services')
    .select('id, name, duration_minutes')
    .eq('id', serviceId)
    .eq('tenant_id', resolved.tenantId)
    .eq('is_active', true)
    .maybeSingle()
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  const durationMinutes: number = (service.duration_minutes as number | null) ?? 60
  const serviceName: string = service.name as string

  let assignedStaffId: string | null = null
  if (staffId) {
    const { data: mapping } = await supabase
      .from('staff_services')
      .select('id')
      .eq('tenant_id', resolved.tenantId)
      .eq('service_id', serviceId)
      .eq('staff_id', staffId)
      .maybeSingle()
    if (mapping) assignedStaffId = staffId
  }

  const { data: contact } = await supabase
    .from('contacts')
    .select('full_name')
    .eq('id', resolved.contactId)
    .eq('tenant_id', resolved.tenantId)
    .maybeSingle()
  const contactName = (contact?.full_name as string | null) ?? 'Customer'

  const creds = await getTenantCalendarCredentials(resolved.tenantId)
  if (creds) {
    const available = await isSlotAvailable(
      creds,
      date,
      startTime,
      durationMinutes,
      assignedStaffId ?? undefined
    )
    if (!available) {
      res.status(409).json({ error: 'This time slot is no longer available' })
      return
    }
  }

  const { data: primaryLocation } = await supabase
    .from('locations')
    .select('id')
    .eq('tenant_id', resolved.tenantId)
    .eq('is_primary', true)
    .maybeSingle()
  const locationId: string | null = (primaryLocation?.id as string | null) ?? null

  let googleEventId: string | null = null
  let startIso: string | null = null
  let endIso: string | null = null
  if (creds) {
    try {
      const calResult = await createCalendarEvent(
        creds,
        date,
        startTime,
        durationMinutes,
        `${serviceName} — ${contactName}`,
        `Booked via customer portal${notes ? `\nNotes: ${notes}` : ''}`
      )
      googleEventId = calResult.googleEventId
      startIso = calResult.startIso
      endIso = calResult.endIso
    } catch (err) {
      console.error('[portal] Google Calendar event creation failed:', err)
    }
  }
  if (!startIso) {
    startIso = `${date}T${startTime}:00.000Z`
    endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      tenant_id: resolved.tenantId,
      contact_id: resolved.contactId,
      location_id: locationId,
      assigned_staff_id: assignedStaffId,
      title: `${serviceName} — ${contactName}`,
      description: notes,
      start_time: startIso,
      end_time: endIso!,
      status: 'confirmed',
      google_event_id: googleEventId,
      notes: 'Booked via customer portal',
    })
    .select('id')
    .single()

  if (appointmentError || !appointment) {
    res.status(500).json({ error: 'Failed to create appointment' })
    return
  }

  const appointmentId: string = appointment.id as string

  void logActivity({
    tenantId: resolved.tenantId,
    contactId: resolved.contactId,
    type: 'appointment',
    body: `Booked via customer portal: ${serviceName} on ${date} at ${startTime}`,
    metadata: { appointment_id: appointmentId, service_id: serviceId },
    actorType: 'contact',
  })

  void dispatchWebhook(resolved.tenantId, 'appointment.booked', {
    appointment_id: appointmentId,
    contact_id: resolved.contactId,
    title: `${serviceName} — ${contactName}`,
    start_time: startIso,
    end_time: endIso,
  })

  res.status(201).json({ id: appointmentId, start_time: startIso, end_time: endIso })
})

// GET /api/portal/appointments/:id?token= — reschedule/cancel eligibility,
// reused by the dashboard's "Manage" action.
router.get('/appointments/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const appt = await loadPortalAppointment(
    supabase,
    resolved.tenantId,
    resolved.contactId,
    req.params['id'] as string
  )
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const noticeHours = await minNoticeHours(resolved.tenantId)
  res.json({
    title: appt.title,
    start_time: appt.start_time,
    end_time: appt.end_time,
    status: appt.status,
    min_notice_hours: noticeHours,
    can_modify: canModifyAppointment(appt, noticeHours),
  })
})

// GET /api/portal/appointments/:id/available-slots?token=&date=
router.get(
  '/appointments/:id/available-slots',
  async (req: Request, res: Response): Promise<void> => {
    const supabase = getServiceClient()
    const resolved = await resolvePortalToken(supabase, req.query['token'])
    if (!resolved) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }

    const appt = await loadPortalAppointment(
      supabase,
      resolved.tenantId,
      resolved.contactId,
      req.params['id'] as string
    )
    if (!appt) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const date = typeof req.query['date'] === 'string' ? req.query['date'] : ''
    if (!DATE_RE.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' })
      return
    }

    const creds = await getTenantCalendarCredentials(appt.tenant_id)
    if (!creds) {
      res.status(503).json({ error: 'Booking not available' })
      return
    }

    const durationMinutes = Math.round(
      (new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) / 60000
    )
    const { slots, closed } = await getAvailableSlotsForDate(creds, date, durationMinutes)
    res.json({ slots, closed })
  }
)

// POST /api/portal/appointments/:id/reschedule?token=
router.post('/appointments/:id/reschedule', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const appt = await loadPortalAppointment(
    supabase,
    resolved.tenantId,
    resolved.contactId,
    req.params['id'] as string
  )
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const noticeHours = await minNoticeHours(resolved.tenantId)
  if (!canModifyAppointment(appt, noticeHours)) {
    res.status(409).json({
      error: `This appointment can no longer be changed online — it starts in less than ${noticeHours}h, or is already canceled/completed`,
    })
    return
  }

  const b = req.body as Record<string, unknown>
  const date = typeof b['date'] === 'string' ? b['date'] : ''
  const startTime = typeof b['start_time'] === 'string' ? b['start_time'] : ''
  if (!DATE_RE.test(date) || !TIME_RE.test(startTime)) {
    res.status(400).json({ error: 'date (YYYY-MM-DD) and start_time (HH:MM) are required' })
    return
  }

  const result = await rescheduleAppointment(appt, date, startTime, 'contact')
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error })
    return
  }
  res.json(result.data)
})

// POST /api/portal/appointments/:id/cancel?token=
router.post('/appointments/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const resolved = await resolvePortalToken(supabase, req.query['token'])
  if (!resolved) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const appt = await loadPortalAppointment(
    supabase,
    resolved.tenantId,
    resolved.contactId,
    req.params['id'] as string
  )
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const noticeHours = await minNoticeHours(resolved.tenantId)
  if (!canModifyAppointment(appt, noticeHours)) {
    res.status(409).json({
      error: `This appointment can no longer be canceled online — it starts in less than ${noticeHours}h, or is already canceled/completed`,
    })
    return
  }

  const result = await cancelAppointment(appt, 'contact', supabase)
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error })
    return
  }
  res.json({ success: true })
})

// GET /api/portal/by-slug/:slug
router.get('/by-slug/:slug', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, portal_enabled')
    .eq('portal_slug', req.params['slug'])
    .maybeSingle()

  if (!tenant || !tenant.portal_enabled) {
    res.status(404).json({ error: 'Portal not found' })
    return
  }

  res.json({ business_name: tenant.name, portal_enabled: true })
})

// POST /api/portal/request-access
router.post('/request-access', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { slug, email } = req.body as { slug?: string; email?: string }
  if (!slug || !email) {
    res.status(400).json({ error: 'slug and email required' })
    return
  }

  const supabase = getServiceClient()

  // Find tenant by slug
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, portal_slug, portal_enabled')
    .eq('portal_slug', slug)
    .maybeSingle()

  if (!tenant || !tenant.portal_enabled) {
    res.json({ message: 'If you have portal access, check your email.' })
    return
  }

  // Find portal_access by email + tenant
  const { data: access } = await supabase
    .from('portal_access')
    .select('access_token')
    .eq('tenant_id', tenant.id)
    .eq('email', email)
    .maybeSingle()

  if (!access) {
    // Don't leak existence
    res.json({ message: 'If you have portal access, check your email.' })
    return
  }

  // Send magic link
  const portalUrl = `https://app.nuatis.com/portal/${slug}`
  const resendApiKey = process.env['RESEND_API_KEY']
  if (resendApiKey) {
    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    const magicLinkEmail = buildPortalMagicLinkEmail({
      businessName: tenant.name,
      portalUrl,
      accessToken: access.access_token,
    })
    await resend.emails
      .send({
        from: process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>',
        to: email,
        subject: magicLinkEmail.subject,
        html: magicLinkEmail.html,
      })
      .catch(() => null)
  }

  res.json({ message: 'If you have portal access, check your email.' })
})

// ── TENANT-AUTHENTICATED ROUTES ──────────────────────────────────────────────

// POST /api/portal/enable
router.post('/enable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  // Fetch tenant name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()

  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  // Generate slug
  const { generatePortalSlug } = await import('../lib/portal-slug.js')
  const slug = await generatePortalSlug(authed.tenantId, tenant.name)

  // Enable portal
  await supabase.from('tenants').update({ portal_enabled: true }).eq('id', authed.tenantId)

  const portalUrl = `https://app.nuatis.com/portal/${slug}`
  res.json({ portal_slug: slug, portal_url: portalUrl })
})

// POST /api/portal/disable
router.post('/disable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  await supabase.from('tenants').update({ portal_enabled: false }).eq('id', authed.tenantId)

  res.json({ ok: true })
})

// GET /api/portal/settings
router.get('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('portal_enabled, portal_slug')
    .eq('id', authed.tenantId)
    .single()

  const { count: accessCount } = await supabase
    .from('portal_access')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)

  const portalUrl = tenant?.portal_slug
    ? `https://app.nuatis.com/portal/${tenant.portal_slug}`
    : null

  res.json({
    portal_enabled: tenant?.portal_enabled ?? false,
    portal_slug: tenant?.portal_slug ?? null,
    portal_url: portalUrl,
    access_count: accessCount ?? 0,
  })
})

// POST /api/portal/invite/:contactId
router.post(
  '/invite/:contactId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    // Fetch contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, full_name, email')
      .eq('id', req.params['contactId'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    if (!contact.email) {
      res.status(400).json({ error: 'Contact has no email address' })
      return
    }

    // Check if portal_access already exists
    const { data: existing } = await supabase
      .from('portal_access')
      .select('access_token')
      .eq('tenant_id', authed.tenantId)
      .eq('contact_id', req.params['contactId'])
      .maybeSingle()

    let accessToken: string
    if (existing) {
      accessToken = existing.access_token
    } else {
      // Insert new portal_access row — generate token in app code (not DB default)
      const newToken = randomBytes(32).toString('hex')
      const { data: newAccess, error } = await supabase
        .from('portal_access')
        .insert({
          tenant_id: authed.tenantId,
          contact_id: req.params['contactId'],
          email: contact.email,
          access_token: newToken,
        })
        .select('access_token')
        .single()

      if (error || !newAccess) {
        res.status(500).json({ error: 'Failed to create portal access' })
        return
      }

      accessToken = newAccess.access_token
    }

    // Fetch tenant for portal_slug and name
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, portal_slug')
      .eq('id', authed.tenantId)
      .single()

    const portalUrl = tenant?.portal_slug
      ? `https://app.nuatis.com/portal/${tenant.portal_slug}`
      : 'https://app.nuatis.com/portal'

    // Send invitation email via Resend
    const resendApiKey = process.env['RESEND_API_KEY']
    if (resendApiKey) {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)
      const inviteEmail = buildPortalInviteEmail({
        contactName: contact.full_name,
        businessName: tenant?.name,
        portalUrl,
        accessToken,
      })
      await resend.emails
        .send({
          from: process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>',
          to: contact.email,
          subject: inviteEmail.subject,
          html: inviteEmail.html,
        })
        .catch(() => null) // don't fail if email fails
    }

    res.json({ access_token: accessToken, portal_url: `${portalUrl}?token=${accessToken}` })
  }
)

// GET /api/portal/clients
router.get('/clients', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data } = await supabase
    .from('portal_access')
    .select('contact_id, email, last_accessed_at, created_at, contacts(full_name)')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  res.json({ clients: data ?? [] })
})

// DELETE /api/portal/access/:contactId
router.delete(
  '/access/:contactId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    await supabase
      .from('portal_access')
      .delete()
      .eq('tenant_id', authed.tenantId)
      .eq('contact_id', req.params['contactId'])

    res.json({ ok: true })
  }
)

export default router
