import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import {
  getTenantCalendarCredentials,
  getAvailableSlotsForDate,
  isSlotAvailable,
  createCalendarEvent,
} from '../lib/booking-availability.js'
import { logActivity } from '../lib/activity.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'
import { sendSms } from '../lib/sms.js'
import { buildConfirmationSms } from '../lib/sms-templates.js'
import { sendPushNotification } from '../lib/push-client.js'
import { autoEnrichContact } from '../lib/contact-enrichment.js'
import { bookingLimiter } from '../middleware/rate-limit.js'

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3000'

const router = Router()

// ── GET /:slug — booking page data ───────────────────────────────────────────
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const supabase = getServiceClient()

  // Look up tenant by booking_page_slug
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(
      'id, name, booking_page_enabled, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
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

  const businessPhone = (location?.telnyx_number as string | null) ?? null

  const { data: resources } = await supabase
    .from('bookable_resources')
    .select('id, name, resource_type, color, capacity, status')
    .eq('tenant_id', tenant.id as string)
    .eq('status', 'active')
    .order('name', { ascending: true })

  const { data: tenantFull } = await supabase
    .from('tenants')
    .select('vertical')
    .eq('id', tenant.id as string)
    .maybeSingle()

  // Staff picker data — only services with mapped staff show a picker;
  // services with none are unaffected (no staff needed to book them).
  // Manual batch-fetch-and-merge (not a nested select): staff_services.staff_id
  // doesn't follow the singular-table-name FK convention some helpers assume.
  const staffByService: Record<string, { id: string; name: string; color_hex: string }[]> = {}
  if (services.length > 0) {
    const { data: mappings } = await supabase
      .from('staff_services')
      .select('service_id, staff_id')
      .eq('tenant_id', tenantId)
      .in(
        'service_id',
        services.map((s) => s.id)
      )

    const staffIds = [...new Set((mappings ?? []).map((m) => m.staff_id as string))]
    if (staffIds.length > 0) {
      const { data: staffRows } = await supabase
        .from('staff_members')
        .select('id, name, color_hex, is_active')
        .eq('tenant_id', tenantId)
        .in('id', staffIds)

      const staffById = new Map(
        (staffRows ?? [])
          .filter((s) => s.is_active)
          .map((s) => [
            s.id as string,
            { id: s.id as string, name: s.name as string, color_hex: s.color_hex as string },
          ])
      )

      for (const row of mappings ?? []) {
        const staffInfo = staffById.get(row.staff_id as string)
        if (!staffInfo) continue
        const serviceId = row.service_id as string
        if (!staffByService[serviceId]) staffByService[serviceId] = []
        staffByService[serviceId].push(staffInfo)
      }
    }
  }

  res.json({
    tenantId,
    businessName: tenant.name,
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
    resources: resources ?? [],
    staffByService,
    vertical: tenantFull?.vertical ?? null,
  })
})

// ── GET /:slug/availability — available slots for a date ─────────────────────
router.get('/:slug/availability', async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params
  const { serviceId, date, staffId } = req.query as Record<string, string>

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

  const supabase = getServiceClient()

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

  // A staffId is only honored if it's actually mapped to this service —
  // otherwise silently ignore rather than error (defensive against stale UI state).
  let staffFilter: string | undefined
  if (staffId) {
    const { data: mapping } = await supabase
      .from('staff_services')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId)
      .eq('staff_id', staffId)
      .maybeSingle()
    if (mapping) staffFilter = staffId
  }

  // Get calendar credentials
  const creds = await getTenantCalendarCredentials(tenantId)

  if (!creds) {
    res.status(200).json({ date, slots: [] })
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

// ── POST /:slug/confirm — book appointment ───────────────────────────────────
router.post(
  '/:slug/confirm',
  bookingLimiter,
  async (req: Request, res: Response): Promise<void> => {
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
      resource_id,
      referralCode,
      staffId,
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
      resource_id?: string
      referralCode?: string
      staffId?: string
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

    const supabase = getServiceClient()

    // Look up tenant by slug
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(
        'id, booking_page_enabled, booking_buffer_minutes, booking_confirmation_message, booking_accent_color, name, vertical'
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

    // A staffId is only honored if it's actually mapped to this service.
    let assignedStaffId: string | null = null
    if (staffId) {
      const { data: mapping } = await supabase
        .from('staff_services')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('service_id', serviceId!)
        .eq('staff_id', staffId)
        .maybeSingle()
      if (mapping) assignedStaffId = staffId
    }

    // Re-check slot availability
    const creds = await getTenantCalendarCredentials(tenantId)
    if (creds) {
      const available = await isSlotAvailable(
        creds,
        date!,
        startTime!,
        durationMinutes,
        assignedStaffId ?? undefined
      )
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

    // Resolve a customer-referral code (if any) to the referring contact —
    // separate from Nuatis's own tenant-affiliate referral_codes table.
    let referrerContactId: string | null = null
    if (typeof referralCode === 'string' && referralCode.trim()) {
      const { data: referralRow } = await supabase
        .from('contact_referral_codes')
        .select('id, contact_id')
        .eq('tenant_id', tenantId)
        .eq('code', referralCode.trim().toUpperCase())
        .eq('status', 'active')
        .maybeSingle()
      if (referralRow) {
        referrerContactId = referralRow.contact_id as string
      }
    }

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
      // Backfill attribution only if this contact has none yet — never
      // overwrite an existing referrer.
      if (referrerContactId) {
        await supabase
          .from('contacts')
          .update({
            referred_by_contact_id: referrerContactId,
            referral_source_detail: 'Referral link',
          })
          .eq('id', contactId)
          .eq('tenant_id', tenantId)
          .is('referred_by_contact_id', null)
      }
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
        if (referrerContactId) {
          await supabase
            .from('contacts')
            .update({
              referred_by_contact_id: referrerContactId,
              referral_source_detail: 'Referral link',
            })
            .eq('id', contactId)
            .eq('tenant_id', tenantId)
            .is('referred_by_contact_id', null)
        }
      } else {
        // Create new contact
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            tenant_id: tenantId,
            full_name: fullName,
            email: email!,
            phone: phone!,
            source: referrerContactId ? 'referral' : 'web_form',
            referred_by_contact_id: referrerContactId,
            referral_source_detail: referrerContactId ? 'Referral link' : null,
            sms_opt_in: true, // Submitting phone on booking form = explicit TCPA consent
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
          if (enrichResult.updates.timezone)
            enrichUpdates['timezone'] = enrichResult.updates.timezone
          if (enrichResult.suggestedCompany) {
            enrichUpdates['vertical_data'] = {
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
        assigned_staff_id: assignedStaffId,
        title: `${serviceName} — ${fullName}`,
        description: notes ?? '',
        start_time: startIso,
        end_time: endIso!,
        status: 'confirmed',
        google_event_id: googleEventId,
        notes: 'Booked via online booking page',
      })
      .select('id, manage_token')
      .single()

    if (appointmentError || !appointment) {
      res.status(500).json({ error: 'Failed to create appointment' })
      return
    }

    const appointmentId: string = appointment.id as string
    const manageUrl = `${WEB_URL.replace(/\/+$/, '')}/book/manage/${appointment.manage_token as string}`

    // Insert resource booking if resource_id provided (fire-and-forget)
    if (resource_id) {
      void supabase.from('resource_bookings').insert({
        tenant_id: tenantId,
        resource_id,
        appointment_id: appointmentId,
        contact_id: contactId,
        start_time: startIso,
        end_time: endIso,
        status: 'confirmed',
      })
    }

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

    void dispatchWebhook(tenantId, 'appointment.booked', {
      appointment_id: appointmentId,
      contact_id: contactId,
      title: `${serviceName} — ${fullName}`,
      start_time: startIso,
      end_time: endIso,
    })

    if (contactId) enqueueScoreCompute(tenant.id, contactId, 'appointment_booked')

    // Send SMS confirmation
    if (telnyxNumber && phone) {
      const smsBody = `${buildConfirmationSms({
        contactName: firstName ?? null,
        businessName: (tenant.name as string | undefined) ?? 'your business',
        appointmentDateTime: `${date} at ${startTime}`,
        vertical: (tenant.vertical as string | undefined) ?? 'sales_crm',
      })} Manage booking: ${manageUrl}`
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
      manageUrl,
    })
  }
)

export default router
