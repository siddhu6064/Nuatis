import { Type, type FunctionDeclaration } from '@google/genai'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS } from '@nuatis/shared'
import { getCalendarClient } from '../services/google.js'
import { callSessionState } from './post-call.js'

export interface ToolCallContext {
  tenantId: string
  vertical: string
  callerId: string
  streamId: string
  callControlId: string
  product: 'maya_only' | 'suite'
}

export const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_business_hours',
    description:
      'Returns the business hours and days of operation for this business. Call this when a caller asks about hours, when the business is open, or when you need to check if a requested time falls within business hours.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'lookup_contact',
    description:
      'Look up an existing contact in the CRM by their phone number. Use this to check if the caller is already a known contact. Returns contact details if found, or indicates the contact is new.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone_number: {
          type: Type.STRING,
          description: 'Phone number in E.164 format, e.g. +15125551234',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'check_availability',
    description:
      'Check available appointment slots on the business calendar for a given date. Use this when a caller asks to book an appointment, wants to know available times, or requests a specific time slot. Returns available slots or confirms if a specific time is open.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description:
            'ISO date string, e.g. 2026-04-17. Resolve relative dates like "Thursday" or "tomorrow" to an actual date before calling.',
        },
        preferred_time: {
          type: Type.STRING,
          description:
            'Optional preferred time in HH:MM 24h format, e.g. 14:00. If provided, checks this specific slot. If omitted, returns all available slots for the day.',
        },
        duration_minutes: {
          type: Type.NUMBER,
          description: 'Appointment duration in minutes. Default 60 if not specified.',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'book_appointment',
    description:
      "Book an appointment on the business calendar. Creates a Google Calendar event and saves the appointment in the CRM. Always call check_availability first to verify the slot is open before booking. Requires a date, time, and the caller's name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: {
          type: Type.STRING,
          description: 'ISO date string, e.g. 2026-04-17',
        },
        start_time: {
          type: Type.STRING,
          description: 'Start time in HH:MM 24h format, e.g. 14:00',
        },
        duration_minutes: {
          type: Type.NUMBER,
          description: 'Appointment duration in minutes. Default 60.',
        },
        caller_name: {
          type: Type.STRING,
          description: 'Full name of the caller booking the appointment',
        },
        caller_phone: {
          type: Type.STRING,
          description: "Caller's phone number in E.164 format",
        },
        reason: {
          type: Type.STRING,
          description:
            "Reason for the appointment or service requested, e.g. 'dental cleaning', 'haircut', 'consultation'",
        },
      },
      required: ['date', 'start_time', 'caller_name'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      "Transfer the call to a human staff member. Use this when: the caller explicitly asks to speak with a person, the caller's request is beyond what you can help with, the caller is upset or frustrated, or the situation requires human judgment (legal advice, medical decisions, complex complaints). Before transferring, let the caller know you're connecting them.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: {
          type: Type.STRING,
          description:
            "Brief reason for the escalation, e.g. 'caller requested human', 'complex billing question', 'caller frustrated'",
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'end_call',
    description:
      'End the current phone call. Call this ONLY after you have said goodbye to the caller and the conversation is naturally complete. Do not call this while the caller is still speaking or mid-conversation.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/** Strip everything except digits and leading +, e.g. "+1 (763) 340-6385" → "+17633406385" */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : `+${digits}`
}

const DEFAULT_HOURS = { mon_fri: '9am-5pm', sat: 'closed', sun: 'closed' }
const DEFAULT_TZ = 'America/Chicago'

/** Parse "9am-5pm" → { open: 9, close: 17 } or null for "closed" */
function parseHoursRange(range: string): { open: number; close: number } | null {
  if (range.toLowerCase() === 'closed') return null
  const m = range.match(/^(\d{1,2})(am|pm)\s*-\s*(\d{1,2})(am|pm)$/i)
  if (!m) return null
  let open = parseInt(m[1]!, 10)
  if (m[2]!.toLowerCase() === 'pm' && open !== 12) open += 12
  if (m[2]!.toLowerCase() === 'am' && open === 12) open = 0
  let close = parseInt(m[3]!, 10)
  if (m[4]!.toLowerCase() === 'pm' && close !== 12) close += 12
  if (m[4]!.toLowerCase() === 'am' && close === 12) close = 0
  return { open, close }
}

/** Get business hours window for a specific date based on vertical config */
function getHoursForDate(date: Date, vertical: string): { open: number; close: number } | null {
  const hours = VERTICALS[vertical]?.business_hours ?? DEFAULT_HOURS
  const day = date.getDay() // 0=Sun, 6=Sat
  if (day === 0) return parseHoursRange(hours.sun)
  if (day === 6) return parseHoursRange(hours.sat)
  return parseHoursRange(hours.mon_fri)
}

/** Build a Date for a given date string + hour in a timezone, return ISO string */
function dateAtHour(dateStr: string, hour: number, minute: number, tz: string): string {
  // Build a wall-clock time in the target timezone
  const d = new Date(
    `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  )
  // Use Intl to get the UTC offset for this timezone on this date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  // Find offset by comparing: we want the ISO instant where local time = hour:minute in tz
  // Strategy: create date in UTC, then adjust by the tz offset
  const utcGuess = new Date(
    `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
  )
  const parts = formatter.formatToParts(utcGuess)
  const getPart = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  const localHour = parseInt(getPart('hour'), 10)
  const localMinute = parseInt(getPart('minute'), 10)
  // Offset in minutes: localTime - utcTime (as seen from UTC guess)
  const offsetMinutes =
    localHour * 60 + localMinute - (utcGuess.getUTCHours() * 60 + utcGuess.getUTCMinutes())
  // We want: result_utc + offset = desired_local, so result_utc = desired_local_as_utc - offset
  const result = new Date(utcGuess.getTime() - offsetMinutes * 60_000)
  void d // not used directly
  return result.toISOString()
}

/** Format an hour number (0-23) as a human-readable string, e.g. 8 → "8:00 AM", 17 → "5:00 PM" */
function formatHourAmPm(hour: number): string {
  if (hour === 0) return '12:00 AM'
  if (hour < 12) return `${hour}:00 AM`
  if (hour === 12) return '12:00 PM'
  return `${hour - 12}:00 PM`
}

/** Format a Date to HH:MM in a given timezone */
function formatHHMM(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolCallContext
) => Promise<Record<string, unknown>>

const handlers: Record<string, ToolHandler> = {
  get_business_hours: async (_args, context) => {
    const hours = VERTICALS[context.vertical]?.business_hours ?? DEFAULT_HOURS
    return { business_hours: hours }
  },

  lookup_contact: async (args, context) => {
    if (context.product === 'maya_only') {
      return { found: false, message: 'Contact lookup not available in Maya standalone' }
    }

    const rawPhone = String(args['phone_number'] ?? '')
    const phone = normalizePhone(rawPhone)
    const digitsOnly = phone.replace(/\+/, '')

    console.info(`[tool-handlers] lookup_contact query: phone=${phone} tenant=${context.tenantId}`)

    try {
      const supabase = getSupabase()

      // Try exact E.164 match first, fall back to digits-only match
      let { data, error } = await supabase
        .from('contacts')
        .select(
          'id, full_name, email, phone, phone_alt, tags, notes, source, vertical_data, is_archived, last_contacted'
        )
        .eq('tenant_id', context.tenantId)
        .eq('phone', phone)
        .eq('is_archived', false)
        .limit(1)
        .maybeSingle()

      if (!data && !error) {
        // Retry with digits-only (no + prefix) in case stored format differs
        ;({ data, error } = await supabase
          .from('contacts')
          .select(
            'id, full_name, email, phone, phone_alt, tags, notes, source, vertical_data, is_archived, last_contacted'
          )
          .eq('tenant_id', context.tenantId)
          .eq('phone', digitsOnly)
          .eq('is_archived', false)
          .limit(1)
          .maybeSingle())
      }

      if (error) {
        console.error(`[tool-handlers] lookup_contact error: ${error.message}`)
        console.info('[tool-handlers] lookup_contact result: found=false (error)')
        return { found: false, message: 'Unable to look up contact', error: true }
      }

      if (!data) {
        console.info('[tool-handlers] lookup_contact result: found=false')
        return { found: false, message: 'No existing contact found for this phone number' }
      }

      console.info('[tool-handlers] lookup_contact result: found=true')
      return {
        found: true,
        contact: {
          id: data.id,
          full_name: data.full_name,
          email: data.email,
          phone: data.phone,
          phone_alt: data.phone_alt,
          tags: data.tags,
          notes: data.notes,
          source: data.source,
          vertical_data: data.vertical_data,
          last_contacted: data.last_contacted,
        },
      }
    } catch (err) {
      console.error('[tool-handlers] lookup_contact threw:', err)
      console.info('[tool-handlers] lookup_contact result: found=false (error)')
      return { found: false, message: 'Unable to look up contact', error: true }
    }
  },

  check_availability: async (args, context) => {
    const date = String(args['date'] ?? '')
    const preferredTime = args['preferred_time'] ? String(args['preferred_time']) : null
    const durationMinutes =
      typeof args['duration_minutes'] === 'number' ? args['duration_minutes'] : 60

    console.info(
      `[tool-handlers] check_availability: date=${date} preferred_time=${preferredTime ?? 'any'} tenant=${context.tenantId}`
    )

    // 1. Get tenant's Google Calendar credentials from locations table
    try {
      const supabase = getSupabase()
      const { data: location, error: locErr } = await supabase
        .from('locations')
        .select('google_refresh_token, google_calendar_id')
        .eq('tenant_id', context.tenantId)
        .eq('is_primary', true)
        .maybeSingle()

      if (locErr) {
        console.error(`[tool-handlers] check_availability location query error: ${locErr.message}`)
        return { available: false, error: 'Unable to check calendar' }
      }

      if (!location?.google_refresh_token) {
        console.info('[tool-handlers] check_availability: no Google Calendar tokens for tenant')
        return { available: false, error: 'Google Calendar not connected for this business' }
      }

      const refreshToken = location.google_refresh_token
      const calendarId = location.google_calendar_id || 'primary'

      // 2. Determine business hours window for the requested date
      const requestedDate = new Date(`${date}T12:00:00Z`) // noon UTC to get correct day-of-week
      const hoursWindow = getHoursForDate(requestedDate, context.vertical)

      if (!hoursWindow) {
        console.info('[tool-handlers] check_availability: business is closed on this date')
        return { available: false, date, message: 'The business is closed on this date', slots: [] }
      }

      // 3. If preferred_time given, check business hours BEFORE hitting Calendar API
      const tz = DEFAULT_TZ
      if (preferredTime) {
        const [ptH, ptM] = preferredTime.split(':')
        const reqStartMin = parseInt(ptH!, 10) * 60 + parseInt(ptM ?? '0', 10)
        const reqEndMin = reqStartMin + durationMinutes
        const openMin = hoursWindow.open * 60
        const closeMin = hoursWindow.close * 60

        if (reqStartMin < openMin || reqEndMin > closeMin) {
          // Generate up to 3 suggested slots closest to the requested time
          const allSlots: number[] = []
          for (let m = openMin; m + durationMinutes <= closeMin; m += 60) {
            allSlots.push(m)
          }
          allSlots.sort((a, b) => Math.abs(a - reqStartMin) - Math.abs(b - reqStartMin))
          const suggested = allSlots
            .slice(0, 3)
            .sort((a, b) => a - b)
            .map(
              (m) =>
                `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
            )

          console.info(
            `[tool-handlers] check_availability: preferred_time ${preferredTime} is outside business hours (${hoursWindow.open}-${hoursWindow.close})`
          )
          return {
            available: false,
            reason: 'outside_business_hours',
            message: 'The requested time is outside business hours',
            business_hours: {
              open: formatHourAmPm(hoursWindow.open),
              close: formatHourAmPm(hoursWindow.close),
            },
            suggested_times: suggested,
          }
        }
      }

      // 4. Build time range for freebusy query
      const timeMin = dateAtHour(date, hoursWindow.open, 0, tz)
      const timeMax = dateAtHour(date, hoursWindow.close, 0, tz)

      // 5. Query Google Calendar FreeBusy
      const calendar = getCalendarClient(refreshToken)
      const freeBusy = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: [{ id: calendarId }],
        },
      })

      const busy = freeBusy.data.calendars?.[calendarId]?.busy ?? []
      const busyPeriods = busy.map((b) => ({
        start: new Date(b.start ?? ''),
        end: new Date(b.end ?? ''),
      }))

      // 6a. If preferred_time given, check that specific slot
      if (preferredTime) {
        const [hStr, mStr] = preferredTime.split(':')
        const slotStartIso = dateAtHour(date, parseInt(hStr!, 10), parseInt(mStr ?? '0', 10), tz)
        const slotStart = new Date(slotStartIso)
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000)

        const conflicts = busyPeriods.filter((b) => slotStart < b.end && slotEnd > b.start)

        const isAvailable = conflicts.length === 0
        console.info(
          `[tool-handlers] check_availability: busy_periods=${busyPeriods.length}, available=${isAvailable}`
        )
        return {
          available: isAvailable,
          date,
          requested_slot: {
            start: preferredTime,
            end: formatHHMM(slotEnd, tz),
          },
          ...(conflicts.length > 0
            ? {
                conflicts: conflicts.map((c) => ({
                  start: formatHHMM(c.start, tz),
                  end: formatHHMM(c.end, tz),
                })),
              }
            : {}),
        }
      }

      // 6b. No preferred_time — return all available slots for the day
      const slots: Array<{ start: string; end: string }> = []
      const windowStart = new Date(timeMin)
      const windowEnd = new Date(timeMax)
      const stepMs = durationMinutes * 60_000

      let cursor = windowStart.getTime()
      while (cursor + stepMs <= windowEnd.getTime()) {
        const sStart = new Date(cursor)
        const sEnd = new Date(cursor + stepMs)

        const conflict = busyPeriods.some((b) => sStart < b.end && sEnd > b.start)

        if (!conflict) {
          slots.push({
            start: formatHHMM(sStart, tz),
            end: formatHHMM(sEnd, tz),
          })
        }

        cursor += stepMs
      }

      console.info(
        `[tool-handlers] check_availability: busy_periods=${busyPeriods.length}, available_slots=${slots.length}`
      )
      return { available: slots.length > 0, date, slots }
    } catch (err) {
      console.error('[tool-handlers] check_availability error:', err)
      return { available: false, error: 'Unable to check calendar' }
    }
  },

  book_appointment: async (args, context) => {
    const date = String(args['date'] ?? '')
    const startTime = String(args['start_time'] ?? '')
    const durationMinutes =
      typeof args['duration_minutes'] === 'number' ? args['duration_minutes'] : 60
    const callerName = String(args['caller_name'] ?? '')
    const callerPhone = args['caller_phone']
      ? normalizePhone(String(args['caller_phone']))
      : context.callerId
        ? normalizePhone(context.callerId)
        : ''
    const reason = args['reason'] ? String(args['reason']) : null

    console.info(
      `[tool-handlers] book_appointment: date=${date} time=${startTime} caller=${callerName} tenant=${context.tenantId}`
    )

    try {
      const supabase = getSupabase()

      // 1. Get Calendar credentials
      const { data: location, error: locErr } = await supabase
        .from('locations')
        .select('id, google_refresh_token, google_calendar_id')
        .eq('tenant_id', context.tenantId)
        .eq('is_primary', true)
        .maybeSingle()

      if (locErr) {
        console.error(`[tool-handlers] book_appointment error: ${locErr.message}`)
        return { booked: false, error: 'Unable to access calendar credentials' }
      }

      if (!location?.google_refresh_token) {
        console.info('[tool-handlers] book_appointment: no Google Calendar tokens')
        return { booked: false, error: 'Google Calendar not connected for this business' }
      }

      const refreshToken = location.google_refresh_token
      const calendarId = location.google_calendar_id || 'primary'
      const locationId: string = location.id

      // 2. Build time range
      const tz = DEFAULT_TZ
      const [hStr, mStr] = startTime.split(':')
      const startIso = dateAtHour(date, parseInt(hStr!, 10), parseInt(mStr ?? '0', 10), tz)
      const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()

      // 2b. Safety net — validate business hours before creating event
      const requestedDate = new Date(`${date}T12:00:00Z`)
      const hoursWindow = getHoursForDate(requestedDate, context.vertical)
      if (!hoursWindow) {
        console.info('[tool-handlers] book_appointment: business is closed on this date')
        return { booked: false, error: 'Cannot book — the business is closed on this date' }
      }
      const reqStartMin = parseInt(hStr!, 10) * 60 + parseInt(mStr ?? '0', 10)
      const reqEndMin = reqStartMin + durationMinutes
      if (reqStartMin < hoursWindow.open * 60 || reqEndMin > hoursWindow.close * 60) {
        console.info(
          `[tool-handlers] book_appointment: slot ${startTime} is outside business hours (${hoursWindow.open}-${hoursWindow.close})`
        )
        return {
          booked: false,
          error: 'Cannot book outside business hours',
          business_hours: {
            open: formatHourAmPm(hoursWindow.open),
            close: formatHourAmPm(hoursWindow.close),
          },
        }
      }

      // 3. Create Google Calendar event
      const title = reason ? `${reason} - ${callerName}` : `Appointment - ${callerName}`
      const description = `Booked by Maya AI. Caller: ${callerName}${callerPhone ? `, Phone: ${callerPhone}` : ''}`

      const calendar = getCalendarClient(refreshToken)
      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: title,
          description,
          start: { dateTime: startIso, timeZone: tz },
          end: { dateTime: endIso, timeZone: tz },
        },
      })

      const googleEventId = event.data.id ?? ''
      console.info(`[tool-handlers] book_appointment: gcal event created id=${googleEventId}`)

      // Maya-only: skip CRM operations, return calendar-only result
      if (context.product === 'maya_only') {
        if (context.callControlId) {
          callSessionState.set(context.callControlId, {
            bookedAppointment: true,
            contactId: null,
            appointmentId: null,
          })
        }
        return {
          booked: true,
          google_event_id: googleEventId,
          start: startIso,
          end: endIso,
          appointment_id: null,
          contact_id: null,
        }
      }

      // 4. Upsert contact (best-effort) — Suite only
      let contactId: string | null = null

      if (callerPhone) {
        const digitsOnly = callerPhone.replace(/\+/, '')

        // Try to find existing contact
        let { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', context.tenantId)
          .eq('phone', callerPhone)
          .eq('is_archived', false)
          .limit(1)
          .maybeSingle()

        if (!existing) {
          ;({ data: existing } = await supabase
            .from('contacts')
            .select('id')
            .eq('tenant_id', context.tenantId)
            .eq('phone', digitsOnly)
            .eq('is_archived', false)
            .limit(1)
            .maybeSingle())
        }

        if (existing) {
          contactId = existing.id
          console.info(`[tool-handlers] book_appointment: contact found id=${contactId}`)
        } else {
          // Create new contact
          const { data: newContact, error: contactErr } = await supabase
            .from('contacts')
            .insert({
              tenant_id: context.tenantId,
              full_name: callerName,
              phone: callerPhone,
              source: 'inbound_call',
            })
            .select('id')
            .single()

          if (contactErr) {
            console.error(
              `[tool-handlers] book_appointment: contact insert error: ${contactErr.message}`
            )
          } else {
            contactId = newContact.id
            console.info(`[tool-handlers] book_appointment: contact created id=${contactId}`)
          }
        }
      }

      if (!contactId) {
        // contact_id is NOT NULL — must create a minimal contact
        const { data: fallbackContact, error: fbErr } = await supabase
          .from('contacts')
          .insert({
            tenant_id: context.tenantId,
            full_name: callerName,
            phone: callerPhone || null,
            source: 'inbound_call',
          })
          .select('id')
          .single()

        if (fbErr) {
          console.error(
            `[tool-handlers] book_appointment: fallback contact insert error: ${fbErr.message}`
          )
          // Calendar event was already created — return partial success
          return {
            booked: true,
            google_event_id: googleEventId,
            start: startIso,
            end: endIso,
            appointment_id: null,
            contact_id: null,
            warning: 'Calendar event created but CRM record could not be saved',
          }
        }
        contactId = fallbackContact.id
        console.info(`[tool-handlers] book_appointment: fallback contact created id=${contactId}`)
      }

      // 5. Insert appointment
      const { data: appointment, error: apptErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id: context.tenantId,
          contact_id: contactId,
          location_id: locationId,
          title,
          description,
          start_time: startIso,
          end_time: endIso,
          status: 'scheduled',
          google_event_id: googleEventId,
          notes: reason,
        })
        .select('id')
        .single()

      if (apptErr) {
        console.error(
          `[tool-handlers] book_appointment: appointment insert error: ${apptErr.message}`
        )
        // Calendar event exists — return partial success
        return {
          booked: true,
          google_event_id: googleEventId,
          start: startIso,
          end: endIso,
          appointment_id: null,
          contact_id: contactId,
          warning: 'Calendar event created but appointment record could not be saved',
        }
      }

      console.info(`[tool-handlers] book_appointment: appointment saved id=${appointment.id}`)

      // Track booking in session state for post-call automation
      if (context.callControlId) {
        callSessionState.set(context.callControlId, {
          bookedAppointment: true,
          contactId,
          appointmentId: appointment.id,
        })
      }

      return {
        booked: true,
        appointment_id: appointment.id,
        google_event_id: googleEventId,
        contact_id: contactId,
        start: startIso,
        end: endIso,
      }
    } catch (err) {
      console.error('[tool-handlers] book_appointment error:', err)
      return { booked: false, error: 'Unable to book appointment' }
    }
  },

  escalate_to_human: async (args, context) => {
    const reason = String(args['reason'] ?? 'caller requested human')
    const ccId = context.callControlId

    console.info(
      `[tool-handlers] escalate_to_human: reason="${reason}" tenant=${context.tenantId} caller=${context.callerId}`
    )

    if (!ccId) {
      console.warn('[tool-handlers] escalate_to_human: no callControlId available')
      return { transferred: false, error: 'No call control ID available' }
    }

    try {
      const supabase = getSupabase()
      const apiKey = process.env['TELNYX_API_KEY']
      if (!apiKey) {
        console.error('[tool-handlers] escalate_to_human: TELNYX_API_KEY not set')
        return {
          transferred: false,
          error: 'Unable to transfer call — phone system not configured',
        }
      }

      // 1. Get escalation phone + Telnyx from number from locations
      const { data: location } = await supabase
        .from('locations')
        .select('telnyx_number, escalation_phone')
        .eq('tenant_id', context.tenantId)
        .eq('is_primary', true)
        .maybeSingle()

      const escalationPhone =
        location?.escalation_phone ?? process.env['ESCALATION_PHONE_DEFAULT'] ?? null
      const fromNumber = location?.telnyx_number

      if (!escalationPhone) {
        console.warn(
          `[tool-handlers] escalate_to_human: no escalation phone configured for tenant=${context.tenantId}`
        )
        return {
          transferred: false,
          error:
            'No escalation phone number configured for this business. Please take a message and offer to have someone call the caller back.',
        }
      }

      // 2. Fire-and-forget SMS to the business owner before transferring
      if (fromNumber) {
        const smsText = `Incoming call transfer from Maya AI. Caller: ${context.callerId || 'unknown'}. Reason: ${reason}. Connecting now.`

        void fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromNumber,
            to: escalationPhone,
            text: smsText,
          }),
        })
          .then((res) => {
            if (res.ok) {
              console.info('[tool-handlers] escalate_to_human: SMS sent to owner')
            } else {
              res.text().then((body) => {
                console.error(
                  `[tool-handlers] escalate_to_human: SMS failed (${res.status}): ${body}`
                )
              })
            }
          })
          .catch((err) => {
            console.error('[tool-handlers] escalate_to_human: SMS error:', err)
          })
      } else {
        console.warn('[tool-handlers] escalate_to_human: no Telnyx number — skipping SMS')
      }

      // 3. Transfer call via Telnyx
      const transferRes = await fetch(`https://api.telnyx.com/v2/calls/${ccId}/actions/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: escalationPhone }),
      })

      if (!transferRes.ok) {
        const body = await transferRes.text()
        console.error(
          `[tool-handlers] escalate_to_human: transfer failed (${transferRes.status}): ${body}`
        )
        return { transferred: false, error: 'Call transfer failed. Please take a message instead.' }
      }

      console.info(`[tool-handlers] escalate_to_human: call transferred to ${escalationPhone}`)

      // 4. Track escalation in session state for post-call automation
      if (ccId) {
        const existing = callSessionState.get(ccId)
        callSessionState.set(ccId, {
          bookedAppointment: existing?.bookedAppointment ?? false,
          contactId: existing?.contactId ?? null,
          appointmentId: existing?.appointmentId ?? null,
          escalated: true,
          escalationReason: reason,
        })
      }

      return { transferred: true, transferred_to: 'owner', reason }
    } catch (err) {
      console.error('[tool-handlers] escalate_to_human error:', err)
      return { transferred: false, error: 'Unable to transfer call' }
    }
  },

  end_call: async (_args, context) => {
    const ccId = context.callControlId
    if (!ccId) {
      console.warn('[tool-handlers] end_call: no callControlId available')
      return { ended: false, error: 'No call control ID available' }
    }

    console.info(
      `[tool-handlers] end_call: hanging up call_control_id=${ccId} tenant=${context.tenantId}`
    )

    // Return immediately, schedule hangup after 2s so farewell audio finishes playing
    setTimeout(() => {
      const apiKey = process.env['TELNYX_API_KEY']
      if (!apiKey) {
        console.error('[tool-handlers] end_call: TELNYX_API_KEY not set')
        return
      }
      fetch(`https://api.telnyx.com/v2/calls/${ccId}/actions/hangup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
        .then((res) => {
          if (res.ok) {
            console.info('[tool-handlers] end_call: hangup successful')
          } else {
            res.text().then((body) => {
              console.error(`[tool-handlers] end_call: hangup failed (${res.status}): ${body}`)
            })
          }
        })
        .catch((err) => {
          console.error('[tool-handlers] end_call error:', err)
        })
    }, 2000)

    return { ended: true, message: 'Call will end in 2 seconds' }
  },
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  context: ToolCallContext
): Promise<Record<string, unknown>> {
  console.info(`[tool-handlers] executing ${name} for tenant=${context.tenantId}`)
  const handler = handlers[name]
  if (!handler) {
    console.error(`[tool-handlers] unknown tool: ${name}`)
    return { error: `Unknown tool: ${name}` }
  }
  const result = await handler(args, context)
  console.info(`[tool-handlers] ${name} result: ${JSON.stringify(result)}`)

  // Track tool call in session state for voice_sessions persistence
  if (context.callControlId) {
    const existing = callSessionState.get(context.callControlId)
    if (existing) {
      const toolCalls = existing.toolCalls ?? []
      toolCalls.push({ name, timestamp: new Date().toISOString() })
      existing.toolCalls = toolCalls
    } else {
      // Initialize session state if no tool has set it yet
      callSessionState.set(context.callControlId, {
        bookedAppointment: false,
        contactId: null,
        appointmentId: null,
        toolCalls: [{ name, timestamp: new Date().toISOString() }],
      })
    }
  }

  return result
}
