import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import {
  getTenantCalendarCredentials,
  getAvailableSlotsForDate,
  isSlotAvailable,
  createCalendarEvent,
} from '../lib/booking-availability.js'
import { logActivity } from '../lib/activity.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'
import { sendSms } from '../lib/sms.js'
import { sendPushNotification } from '../lib/push-client.js'
import { autoEnrichContact } from '../lib/contact-enrichment.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /:slug — booking page data ───────────────────────────────────────────
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const supabase = getSupabase()

  // Look up tenant by booking_page_slug
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(
      'id, business_name, phone, booking_page_enabled, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
    )
    .eq('booking_page_slug', slug)
    .maybeSingle()

  if (tenantError || !tenant || !tenant.booking_page_enabled) {
    res.status(404).json({ error: 'Booking page not found' })
    return
  }

  const tenantId: string = tenant.id as string

  // Get services in the booking_services list that are active
  const bookingServiceIds: string[] = (tenant.booking_services as string[]) ?? []

  let services: {
    id: string
    name: string
    description: string | null
    duration_minutes: number | null
    unit_price: number
  }[] = []

  if (bookingServiceIds.length > 0) {
    const { data: servicesData } = await supabase
      .from('services')
      .select('id, name, description, duration_minutes, unit_price')
      .in('id', bookingServiceIds)
      .eq('is_active', true)
      .eq('tenant_id', tenantId)

    services = (servicesData ?? []) as typeof services
  }

  // Get intake forms for this tenant that are active
  const { data: formsData } = await supabase
    .from('intake_forms')
    .select('id, name, description, fields, linked_service_ids')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  // Build service_id → form map (a service gets the first matching form)
  const intakeForms: Record<
    string,
    { id: string; name: string; description: string | null; fields: unknown[] }
  > = {}

  for (const form of formsData ?? []) {
    const linkedIds = (form.linked_service_ids as string[]) ?? []
    for (const serviceId of linkedIds) {
      if (!intakeForms[serviceId]) {
        intakeForms[serviceId] = {
          id: form.id as string,
          name: form.name as string,
          description: (form.description as string | null) ?? null,
          fields: (form.fields as unknown[]) ?? [],
        }
      }
    }
  }

  // Get primary location for telnyx_number (tenant phone)
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  const businessPhone =
    (location?.telnyx_number as string | null) ?? (tenant.phone as string | null) ?? null

  res.json({
    tenantId,
    businessName: tenant.business_name,
    businessPhone,
    accentColor: tenant.booking_accent_color ?? '#2563eb',
    confirmationMessage:
      tenant.booking_confirmation_message ??
      'Your appointment has been booked! We look forward to seeing you.',
    googleReviewUrl: tenant.booking_google_review_url ?? null,
    bufferMinutes: tenant.booking_buffer_minutes ?? 15,
    advanceDays: tenant.booking_advance_days ?? 30,
    services,
    intakeForms,
  })
})

// ── GET /:slug/availability — available slots for a date ─────────────────────
router.get('/:slug/availability', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const { serviceId, date } = req.query as Record<string, string>

  // Validate required params
  if (!serviceId || !date) {
    res.status(400).json({ error: 'serviceId and date query params are required' })
    return
  }

  // Validate YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format' })
    return
  }

  const supabase = getSupabase()

  // Look up tenant by slug
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, booking_page_enabled, booking_buffer_minutes, booking_advance_days')
    .eq('booking_page_slug', slug)
    .maybeSingle()

  if (tenantError || !tenant || !tenant.booking_page_enabled) {
    res.status(404).json({ error: 'Booking page not found' })
    return
  }

  const tenantId: string = tenant.id as string
  const bufferMinutes: number = (tenant.booking_buffer_minutes as number) ?? 15
  const advanceDays: number = (tenant.booking_advance_days as number) ?? 30

  // Validate date is not in the past
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const requestedDate = new Date(`${date}T00:00:00`)
  if (requestedDate < today) {
    res.status(400).json({ error: 'Date cannot be in the past' })
    return
  }

  // Validate date is within advance booking window
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + advanceDays)
  if (requestedDate > maxDate) {
    res.status(400).json({ error: `Date must be within ${advanceDays} days from today` })
    return
  }

  // Get service duration
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('duration_minutes')
    .eq('id', serviceId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (serviceError || !service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const durationMinutes: number = (service.duration_minutes as number | null) ?? 60

  // Get calendar credentials
  const creds = await getTenantCalendarCredentials(tenantId)

  if (!creds) {
    res.status(200).json({ date, slots: [] })
    return
  }

  const { slots } = await getAvailableSlotsForDate(creds, date, durationMinutes, bufferMinutes)

  res.json({ date, slots })
})

// ── POST /:slug/confirm — book appointment ───────────────────────────────────
router.post('/:slug/confirm', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const body = req.body as Record<string, unknown>

  const {
    serviceId,
    date,
    startTime,
    firstName,
    lastName,
    email,
    phone,
    intakeFormId,
    intakeData,
    notes,
  } = body as {
    serviceId?: string
    date?: string
    startTime?: string
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
    intakeFormId?: string
    intakeData?: Record<string, unknown>
    notes?: string
  }

  // Validate required fields
  const missing: string[] = []
  if (!serviceId) missing.push('serviceId')
  if (!date) missing.push('date')
  if (!startTime) missing.push('startTime')
  if (!firstName) missing.push('firstName')
  if (!lastName) missing.push('lastName')
  if (!email) missing.push('email')
  if (!phone) missing.push('phone')

  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` })
    return
  }

  const supabase = getSupabase()

  // Look up tenant by slug
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(
      'id, booking_page_enabled, booking_buffer_minutes, booking_confirmation_message, booking_accent_color'
    )
    .eq('booking_page_slug', slug)
    .maybeSingle()

  if (tenantError || !tenant || !tenant.booking_page_enabled) {
    res.status(404).json({ error: 'Booking page not found' })
    return
  }

  const tenantId: string = tenant.id as string
  const confirmationMessage: string =
    (tenant.booking_confirmation_message as string | null) ??
    'Your appointment has been booked! We look forward to seeing you.'

  // Get service
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('id, name, duration_minutes')
    .eq('id', serviceId!)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (serviceError || !service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const durationMinutes: number = (service.duration_minutes as number | null) ?? 60
  const serviceName: string = service.name as string

  // Re-check slot availability
  const creds = await getTenantCalendarCredentials(tenantId)
  if (creds) {
    const available = await isSlotAvailable(creds, date!, startTime!, durationMinutes)
    if (!available) {
      res.status(409).json({ error: 'This time slot is no longer available' })
      return
    }
  }

  // Get primary location
  const { data: primaryLocation } = await supabase
    .from('locations')
    .select('id, telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  const locationId: string | null = (primaryLocation?.id as string | null) ?? null
  const telnyxNumber: string | null = (primaryLocation?.telnyx_number as string | null) ?? null

  // Find or create contact — match by phone first, then email
  let contactId: string | null = null
  const fullName = `${firstName!.trim()} ${lastName!.trim()}`

  const { data: byPhone } = await supabase
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone!)
    .maybeSingle()

  if (byPhone) {
    contactId = byPhone.id as string
    // Update name
    await supabase
      .from('contacts')
      .update({ full_name: fullName })
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
  } else {
    // Try match by email
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', email!)
      .maybeSingle()

    if (byEmail) {
      contactId = byEmail.id as string
      // Update name
      await supabase
        .from('contacts')
        .update({ full_name: fullName })
        .eq('id', contactId)
        .eq('tenant_id', tenantId)
    } else {
      // Create new contact
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          tenant_id: tenantId,
          full_name: fullName,
          email: email!,
          phone: phone!,
          source: 'booking_page',
        })
        .select('id')
        .single()

      if (contactError || !newContact) {
        res.status(500).json({ error: 'Failed to create contact' })
        return
      }

      contactId = newContact.id as string

      // Auto-enrich new contact
      try {
        const enrichResult = autoEnrichContact({ phone: phone!, email: email! })
        const enrichUpdates: Record<string, unknown> = {}
        if (enrichResult.updates.city) enrichUpdates['city'] = enrichResult.updates.city
        if (enrichResult.updates.state) enrichUpdates['state'] = enrichResult.updates.state
        if (enrichResult.updates.timezone) enrichUpdates['timezone'] = enrichResult.updates.timezone
        if (enrichResult.suggestedCompany) {
          enrichUpdates['custom_fields'] = {
            enrichment_suggested_company: enrichResult.suggestedCompany,
          }
        }
        if (Object.keys(enrichUpdates).length > 0) {
          await supabase.from('contacts').update(enrichUpdates).eq('id', contactId)
        }
      } catch (err) {
        console.error('[enrichment] Failed:', err)
      }
    }
  }

  // Create Google Calendar event if calendar connected
  let googleEventId: string | null = null
  let startIso: string | null = null
  let endIso: string | null = null

  if (creds) {
    try {
      const calResult = await createCalendarEvent(
        creds,
        date!,
        startTime!,
        durationMinutes,
        `${serviceName} — ${fullName}`,
        `Booked via online booking page\nClient: ${fullName}\nPhone: ${phone}\nEmail: ${email}${notes ? `\nNotes: ${notes}` : ''}`
      )
      googleEventId = calResult.googleEventId
      startIso = calResult.startIso
      endIso = calResult.endIso
    } catch (err) {
      console.error('[booking] Google Calendar event creation failed:', err)
      // Non-fatal
    }
  }

  // Compute start/end times if not from calendar
  if (!startIso) {
    // Build a rough ISO from date + startTime (UTC approximation)
    startIso = `${date}T${startTime}:00.000Z`
    endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()
  }

  // Insert appointment
  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      location_id: locationId,
      title: `${serviceName} — ${fullName}`,
      description: notes ?? '',
      start_time: startIso,
      end_time: endIso!,
      status: 'confirmed',
      google_event_id: googleEventId,
      notes: 'Booked via online booking page',
    })
    .select('id')
    .single()

  if (appointmentError || !appointment) {
    res.status(500).json({ error: 'Failed to create appointment' })
    return
  }

  const appointmentId: string = appointment.id as string

  // Insert intake submission if provided
  if (intakeFormId && intakeData) {
    const { error: submissionError } = await supabase.from('intake_submissions').insert({
      tenant_id: tenantId,
      form_id: intakeFormId,
      contact_id: contactId,
      appointment_id: appointmentId,
      data: intakeData,
    })

    if (!submissionError) {
      void logActivity({
        tenantId,
        contactId: contactId ?? undefined,
        type: 'system',
        body: 'Intake form submitted via online booking page',
        metadata: { form_id: intakeFormId, appointment_id: appointmentId },
        actorType: 'system',
      })
    }
  }

  // Log appointment activity
  void logActivity({
    tenantId,
    contactId: contactId ?? undefined,
    type: 'appointment',
    body: `Booked via online booking page: ${serviceName} on ${date} at ${startTime}`,
    metadata: { appointment_id: appointmentId, service_id: serviceId },
    actorType: 'system',
  })

  if (contactId) enqueueScoreCompute(tenant.id, contactId, 'appointment_booked')

  // Send SMS confirmation
  if (telnyxNumber && phone) {
    const smsBody = `Hi ${firstName}, your appointment for ${serviceName} on ${date} at ${startTime} has been confirmed. ${confirmationMessage}`
    void sendSms(telnyxNumber, phone, smsBody, { tenantId, contactId: contactId ?? undefined })
  }

  // Send push notification to tenant
  void sendPushNotification(tenantId, {
    title: 'New Booking',
    body: `${fullName} booked ${serviceName} on ${date} at ${startTime}`,
    url: `/appointments`,
  })

  res.status(201).json({
    success: true,
    appointmentId,
    confirmationMessage,
  })
})

export default router
