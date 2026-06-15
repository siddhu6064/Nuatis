import { Type, type FunctionDeclaration } from '@google/genai'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS, dateAtHour, formatHHMM } from '@nuatis/shared'
import { normalizePhone } from '../lib/phone.js'
import { getCalendarClient } from '../services/google.js'
import { getCalendarCredentials } from '../lib/calendar-provider.js'
import {
  getValidOutlookCalendarToken,
  createOutlookEvent,
  checkOutlookAvailability,
} from '../lib/outlook-calendar.js'
import { callSessionState } from './post-call.js'
import { getMayaCircuitBreaker } from './maya-circuit-breaker.js'
import { sendSms } from '../lib/sms.js'
import { buildConfirmationSms } from '../lib/sms-templates.js'
import { getCachedStaff, setCachedStaff, type CachedStaffMember } from '../lib/staff-cache.js'

export interface ToolCallContext {
  tenantId: string
  vertical: string
  callerId: string
  streamId: string
  callControlId: string
  product: 'maya_only' | 'suite'
  callerContactId?: string | null
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
        staff_name: {
          type: Type.STRING,
          description:
            "Optional staff member name when caller requests a specific provider/stylist/attorney/etc. Matches case-insensitively against the staff directory. When provided, availability is additionally constrained to that staff member's shifts on the requested date.",
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
    name: 'capture_referral_source',
    description:
      'Record how the caller heard about the business. Call this after a successful appointment booking when the caller is a new contact. Ask: "Before we finish — how did you hear about us?" and pass their answer to this tool. This is optional — if the caller hangs up before answering, skip it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        source: {
          type: Type.STRING,
          description:
            'How the caller heard about the business, e.g. "Google", "Instagram", "friend referral", "walk-in", "Yelp"',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'end_call',
    description:
      'End the current phone call. Call this ONLY after you have said goodbye to the caller and the conversation is naturally complete. Do not call this while the caller is still speaking or mid-conversation.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'reschedule_appointment',
    description:
      'Cancel an existing upcoming appointment and book a new one at the requested time. Use when caller says they want to reschedule, change, or move their appointment.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        caller_phone: {
          type: Type.STRING,
          description: 'Caller E.164 phone number',
        },
        new_date: {
          type: Type.STRING,
          description: 'New appointment date in YYYY-MM-DD format',
        },
        new_start_time: {
          type: Type.STRING,
          description: 'New start time in HH:MM 24h format',
        },
        reason: {
          type: Type.STRING,
          description: 'Optional reason for rescheduling',
        },
      },
      required: ['caller_phone', 'new_date', 'new_start_time'],
    },
  },
  {
    name: 'get_appointments',
    description:
      'Look up upcoming appointments for the current caller. Returns appointments scheduled for today or in the future with status scheduled or confirmed. Call this when a caller asks "what are my appointments", "when is my appointment", or "do I have anything booked".',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

async function getStaffContext(tenantId: string): Promise<CachedStaffMember[]> {
  const cached = getCachedStaff(tenantId)
  if (cached) return cached
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('staff_members')
      .select('id, name, role, color_hex, availability')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true })
    const staff = (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      role: r.role as string,
      color_hex: r.color_hex as string,
      availability:
        (r.availability as Record<
          string,
          { enabled?: boolean; start?: string; end?: string }
        > | null) ?? {},
    }))
    setCachedStaff(tenantId, staff)
    return staff
  } catch (err) {
    console.error('[tool-handlers] getStaffContext failed:', err)
    return []
  }
}

function staffAvailableToday(staff: CachedStaffMember, isoDate: string): boolean {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay()
  const key = DAY_KEYS[dow]
  if (!key) return false
  const entry = staff.availability?.[key]
  return Boolean(entry?.enabled)
}

function summarizeStaff(
  staff: CachedStaffMember[],
  isoDate: string
): Array<{ id: string; name: string; role: string; color_hex: string; available_today: boolean }> {
  return staff.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    color_hex: s.color_hex,
    available_today: staffAvailableToday(s, isoDate),
  }))
}

async function fetchShiftsForStaffOnDate(
  tenantId: string,
  staffId: string,
  isoDate: string
): Promise<Array<{ start_time: string; end_time: string }>> {
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('shifts')
      .select('start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('staff_id', staffId)
      .eq('date', isoDate)
      .order('start_time', { ascending: true })
    return (data ?? []).map((r) => ({
      start_time: r.start_time as string,
      end_time: r.end_time as string,
    }))
  } catch {
    return []
  }
}

function timeWithinAnyShift(
  hhmm: string,
  shifts: Array<{ start_time: string; end_time: string }>
): boolean {
  for (const s of shifts) {
    const a = s.start_time.slice(0, 5)
    const b = s.end_time.slice(0, 5)
    if (hhmm >= a && hhmm < b) return true
  }
  return false
}

/** Strip everything except digits and leading +, e.g. "+1 (763) 340-6385" → "+17633406385" */
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
/** Format an hour number (0-23) as a human-readable string, e.g. 8 → "8:00 AM", 17 → "5:00 PM" */
function formatHourAmPm(hour: number): string {
  if (hour === 0) return '12:00 AM'
  if (hour < 12) return `${hour}:00 AM`
  if (hour === 12) return '12:00 PM'
  return `${hour - 12}:00 PM`
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
    const resultStr = await getMayaCircuitBreaker().wrap('lookup_contact', async () => {
      if (context.product === 'maya_only') {
        return JSON.stringify({
          found: false,
          message: 'Contact lookup not available in Maya standalone',
        })
      }

      const rawPhone = String(args['phone_number'] ?? '')
      const phone = normalizePhone(rawPhone)
      const digitsOnly = phone.replace(/\+/, '')

      console.info(
        `[tool-handlers] lookup_contact query: phone=${phone} tenant=${context.tenantId}`
      )

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
          return JSON.stringify({ found: false, message: 'Unable to look up contact', error: true })
        }

        if (!data) {
          console.info('[tool-handlers] lookup_contact result: found=false')
          return JSON.stringify({
            found: false,
            message: 'No existing contact found for this phone number',
          })
        }

        console.info('[tool-handlers] lookup_contact result: found=true')
        return JSON.stringify({
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
        })
      } catch (err) {
        console.error('[tool-handlers] lookup_contact threw:', err)
        console.info('[tool-handlers] lookup_contact result: found=false (error)')
        return JSON.stringify({ found: false, message: 'Unable to look up contact', error: true })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
  },

  check_availability: async (args, context) => {
    // Read-only: only queries calendar freebusy + appointments SELECT. Never inserts/mutates.
    const date = String(args['date'] ?? '')
    const preferredTime = args['preferred_time'] ? String(args['preferred_time']) : null
    const durationMinutes =
      typeof args['duration_minutes'] === 'number' ? args['duration_minutes'] : 60
    const staffNameArg = args['staff_name'] ? String(args['staff_name']).trim() : ''

    const resultStr = await getMayaCircuitBreaker().wrap('check_availability', async () => {
      console.info(
        `[tool-handlers] check_availability: date=${date} preferred_time=${preferredTime ?? 'any'} tenant=${context.tenantId}`
      )

      // Enrich with staff context (cached, TTL 5m). Never blocks main calendar flow on failure.
      const staff = await getStaffContext(context.tenantId)
      const staffSummary = summarizeStaff(staff, date)
      const matchedStaff = staffNameArg
        ? (staff.find((s) => s.name.toLowerCase() === staffNameArg.toLowerCase()) ??
          staff.find((s) => s.name.toLowerCase().includes(staffNameArg.toLowerCase())) ??
          null)
        : null
      const matchedStaffShifts = matchedStaff
        ? await fetchShiftsForStaffOnDate(context.tenantId, matchedStaff.id, date)
        : []
      const staffFields = {
        staff_members: staffSummary,
        ...(matchedStaff
          ? {
              requested_staff_member: {
                id: matchedStaff.id,
                name: matchedStaff.name,
                shifts_today: matchedStaffShifts,
              },
            }
          : {}),
        ...(staffNameArg && !matchedStaff
          ? { requested_staff_member: { name: staffNameArg, not_found: true } }
          : {}),
      }

      // 1. Resolve calendar provider
      try {
        const supabase = getSupabase()
        const calendarCreds = await getCalendarCredentials(context.tenantId)
        const provider = calendarCreds?.provider ?? 'native'

        // 2. Determine business hours window for the requested date
        const requestedDate = new Date(`${date}T12:00:00Z`) // noon UTC to get correct day-of-week
        const hoursWindow = getHoursForDate(requestedDate, context.vertical)

        if (!hoursWindow) {
          console.info('[tool-handlers] check_availability: business is closed on this date')
          return JSON.stringify({
            available: false,
            date,
            message: 'The business is closed on this date',
            slots: [],
            ...staffFields,
          })
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
            return JSON.stringify({
              available: false,
              reason: 'outside_business_hours',
              message: 'The requested time is outside business hours',
              business_hours: {
                open: formatHourAmPm(hoursWindow.open),
                close: formatHourAmPm(hoursWindow.close),
              },
              suggested_times: suggested,
              ...staffFields,
            })
          }
        }

        // 4. Build time range for freebusy query
        const timeMin = dateAtHour(date, hoursWindow.open, 0, tz)
        const timeMax = dateAtHour(date, hoursWindow.close, 0, tz)

        // 5. Fetch busy periods — provider-dependent
        let busyPeriods: Array<{ start: Date; end: Date }> = []

        if (provider === 'google' && calendarCreds) {
          const calendar = getCalendarClient(calendarCreds.refreshToken)
          const freeBusy = await calendar.freebusy.query({
            requestBody: {
              timeMin,
              timeMax,
              items: [{ id: calendarCreds.calendarId }],
            },
          })
          const busy = freeBusy.data.calendars?.[calendarCreds.calendarId]?.busy ?? []
          busyPeriods = busy.map((b) => ({
            start: new Date(b.start ?? ''),
            end: new Date(b.end ?? ''),
          }))
        } else if (provider === 'outlook') {
          const accessToken = await getValidOutlookCalendarToken(context.tenantId)
          const busy = await checkOutlookAvailability(
            accessToken,
            timeMin,
            timeMax,
            calendarCreds?.timezone ?? tz
          )
          busyPeriods = busy.map((b) => ({
            start: new Date(b.start),
            end: new Date(b.end),
          }))
        } else {
          // Native: busy periods from appointments table
          const { data: nativeAppts } = await supabase
            .from('appointments')
            .select('start_time, end_time')
            .eq('tenant_id', context.tenantId)
            .in('status', ['scheduled', 'completed'])
            .lt('start_time', timeMax)
            .gt('end_time', timeMin)
          busyPeriods = (nativeAppts ?? []).map((a: { start_time: string; end_time: string }) => ({
            start: new Date(a.start_time),
            end: new Date(a.end_time),
          }))
        }

        // 6a. If preferred_time given, check that specific slot
        if (preferredTime) {
          const [hStr, mStr] = preferredTime.split(':')
          const slotStartIso = dateAtHour(date, parseInt(hStr!, 10), parseInt(mStr ?? '0', 10), tz)
          const slotStart = new Date(slotStartIso)
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000)

          const conflicts = busyPeriods.filter((b) => slotStart < b.end && slotEnd > b.start)

          // When a specific staff member was requested, additionally verify the
          // slot falls within one of their scheduled shifts for the day.
          const staffShiftBlocks =
            matchedStaff && !timeWithinAnyShift(preferredTime, matchedStaffShifts)
              ? [{ reason: 'staff_not_scheduled', shifts: matchedStaffShifts }]
              : []

          const isAvailable = conflicts.length === 0 && staffShiftBlocks.length === 0
          console.info(
            `[tool-handlers] check_availability: busy_periods=${busyPeriods.length}, available=${isAvailable}`
          )
          return JSON.stringify({
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
            ...(staffShiftBlocks.length > 0 ? { staff_shift_conflicts: staffShiftBlocks } : {}),
            ...staffFields,
          })
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

        // When a specific staff member was requested, constrain slots to their shift windows.
        const finalSlots = matchedStaff
          ? slots.filter((s) => timeWithinAnyShift(s.start, matchedStaffShifts))
          : slots

        console.info(
          `[tool-handlers] check_availability: busy_periods=${busyPeriods.length}, available_slots=${finalSlots.length} (staff_filter=${matchedStaff?.name ?? 'none'})`
        )
        return JSON.stringify({
          available: finalSlots.length > 0,
          date,
          slots: finalSlots,
          ...staffFields,
        })
      } catch (err) {
        console.error('[tool-handlers] check_availability error:', err)
        return JSON.stringify({
          available: false,
          error: 'Unable to check calendar',
          ...staffFields,
        })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
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

    const resultStr = await getMayaCircuitBreaker().wrap('book_appointment', async () => {
      console.info(
        `[tool-handlers] book_appointment: date=${date} time=${startTime} caller=${callerName} tenant=${context.tenantId}`
      )

      try {
        const supabase = getSupabase()

        // 1. Resolve calendar provider + primary location id (parallel)
        const [calendarCreds, locationResult] = await Promise.all([
          getCalendarCredentials(context.tenantId),
          supabase
            .from('locations')
            .select('id')
            .eq('tenant_id', context.tenantId)
            .eq('is_primary', true)
            .maybeSingle(),
        ])

        const provider = calendarCreds?.provider ?? 'native'
        const locationId: string | null = locationResult.data?.id ?? null

        // 2. Build time range
        const tz = DEFAULT_TZ
        const [hStr, mStr] = startTime.split(':')
        const startIso = dateAtHour(date, parseInt(hStr!, 10), parseInt(mStr ?? '0', 10), tz)
        const endIso = new Date(
          new Date(startIso).getTime() + durationMinutes * 60_000
        ).toISOString()

        // 2b. Safety net — validate business hours before creating event
        const requestedDate = new Date(`${date}T12:00:00Z`)
        const hoursWindow = getHoursForDate(requestedDate, context.vertical)
        if (!hoursWindow) {
          console.info('[tool-handlers] book_appointment: business is closed on this date')
          return JSON.stringify({
            booked: false,
            error: 'Cannot book — the business is closed on this date',
          })
        }
        const reqStartMin = parseInt(hStr!, 10) * 60 + parseInt(mStr ?? '0', 10)
        const reqEndMin = reqStartMin + durationMinutes
        if (reqStartMin < hoursWindow.open * 60 || reqEndMin > hoursWindow.close * 60) {
          console.info(
            `[tool-handlers] book_appointment: slot ${startTime} is outside business hours (${hoursWindow.open}-${hoursWindow.close})`
          )
          return JSON.stringify({
            booked: false,
            error: 'Cannot book outside business hours',
            business_hours: {
              open: formatHourAmPm(hoursWindow.open),
              close: formatHourAmPm(hoursWindow.close),
            },
          })
        }

        // 3. Create calendar event — branch on provider
        const title = reason ? `${reason} - ${callerName}` : `Appointment - ${callerName}`
        const description = `Booked by Maya AI. Caller: ${callerName}${callerPhone ? `, Phone: ${callerPhone}` : ''}`

        let googleEventId: string | null = null

        if (provider === 'google' && calendarCreds) {
          const calendar = getCalendarClient(calendarCreds.refreshToken)
          const event = await calendar.events.insert({
            calendarId: calendarCreds.calendarId,
            requestBody: {
              summary: title,
              description,
              start: { dateTime: startIso, timeZone: tz },
              end: { dateTime: endIso, timeZone: tz },
            },
          })
          googleEventId = event.data.id ?? ''
          console.info(`[tool-handlers] book_appointment: gcal event created id=${googleEventId}`)
        } else if (provider === 'outlook') {
          const accessToken = await getValidOutlookCalendarToken(context.tenantId)
          const result = await createOutlookEvent(accessToken, {
            subject: title,
            start: startIso,
            end: endIso,
            timezone: calendarCreds?.timezone ?? tz,
            body: description,
          })
          googleEventId = result.id
          console.info(
            `[tool-handlers] book_appointment: outlook event created id=${googleEventId}`
          )
        } else {
          console.info('[tool-handlers] book_appointment: native provider, skipping calendar API')
        }

        // Maya-only: skip CRM operations, return calendar-only result
        if (context.product === 'maya_only') {
          if (context.callControlId) {
            callSessionState.set(context.callControlId, {
              bookedAppointment: true,
              contactId: null,
              appointmentId: null,
            })
          }
          return JSON.stringify({
            booked: true,
            google_event_id: googleEventId,
            start: startIso,
            end: endIso,
            appointment_id: null,
            contact_id: null,
          })
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
            return JSON.stringify({
              booked: true,
              google_event_id: googleEventId,
              start: startIso,
              end: endIso,
              appointment_id: null,
              contact_id: null,
              warning: 'Calendar event created but CRM record could not be saved',
            })
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
          return JSON.stringify({
            booked: true,
            google_event_id: googleEventId,
            start: startIso,
            end: endIso,
            appointment_id: null,
            contact_id: contactId,
            warning: 'Calendar event created but appointment record could not be saved',
          })
        }

        console.info(`[tool-handlers] book_appointment: appointment saved id=${appointment.id}`)

        // Fire-and-forget confirmation SMS — must NEVER throw or block the tool response
        void (async () => {
          try {
            if (!callerPhone) return

            const [locationSms, tenantSms] = await Promise.all([
              supabase
                .from('locations')
                .select('telnyx_number')
                .eq('tenant_id', context.tenantId)
                .eq('is_primary', true)
                .maybeSingle(),
              supabase.from('tenants').select('name').eq('id', context.tenantId).single(),
            ])

            const telnyxNumber = locationSms.data?.telnyx_number
            const businessName = (tenantSms.data?.name as string | undefined) ?? 'your business'

            if (!telnyxNumber) return

            const smsText = buildConfirmationSms({
              contactName: callerName || null,
              businessName,
              appointmentDateTime: `${date} at ${startTime}`,
              vertical: context.vertical,
            })

            const { success } = await sendSms(telnyxNumber, callerPhone, smsText, {
              contactId: contactId ?? undefined,
              tenantId: context.tenantId,
            })
            if (success) {
              console.info(
                `[tool-handlers] book_appointment: confirmation SMS sent to ${callerPhone}`
              )
            }
          } catch (err) {
            console.error('[tool-handlers] book_appointment: confirmation SMS error:', err)
          }
        })()

        // Track booking in session state for post-call automation
        if (context.callControlId) {
          callSessionState.set(context.callControlId, {
            bookedAppointment: true,
            contactId,
            appointmentId: appointment.id,
          })
        }

        return JSON.stringify({
          booked: true,
          appointment_id: appointment.id,
          google_event_id: googleEventId,
          contact_id: contactId,
          start: startIso,
          end: endIso,
        })
      } catch (err) {
        console.error('[tool-handlers] book_appointment error:', err)
        return JSON.stringify({ booked: false, error: 'Unable to book appointment' })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
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

    const resultStr = await getMayaCircuitBreaker().wrap('transfer_call', async () => {
      try {
        const supabase = getSupabase()
        const apiKey = process.env['TELNYX_API_KEY']
        if (!apiKey) {
          console.error('[tool-handlers] escalate_to_human: TELNYX_API_KEY not set')
          return JSON.stringify({
            transferred: false,
            error: 'Unable to transfer call — phone system not configured',
          })
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
          return JSON.stringify({
            transferred: false,
            error:
              'No escalation phone number configured for this business. Please take a message and offer to have someone call the caller back.',
          })
        }

        // 2. Fire-and-forget SMS to the business owner before transferring
        // No contactId/tenantId — owner alert, intentional TCPA bypass
        if (fromNumber) {
          const smsText = `Incoming call transfer from Maya AI. Caller: ${context.callerId || 'unknown'}. Reason: ${reason}. Connecting now.`
          void sendSms(fromNumber, escalationPhone, smsText).then(({ success }) => {
            if (success) {
              console.info('[tool-handlers] escalate_to_human: SMS sent to owner')
            } else {
              console.error('[tool-handlers] escalate_to_human: SMS to owner failed')
            }
          })
        } else {
          console.warn('[tool-handlers] escalate_to_human: no Telnyx number — skipping SMS')
        }

        // 3. Transfer call via Telnyx
        const transferRes = await fetch(
          `https://api.telnyx.com/v2/calls/${ccId}/actions/transfer`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ to: escalationPhone }),
          }
        )

        if (!transferRes.ok) {
          const body = await transferRes.text()
          console.error(
            `[tool-handlers] escalate_to_human: transfer failed (${transferRes.status}): ${body}`
          )
          return JSON.stringify({
            transferred: false,
            error: 'Call transfer failed. Please take a message instead.',
          })
        }

        console.info(`[tool-handlers] escalate_to_human: call transferred to ${escalationPhone}`)

        // 4. Track escalation in session state for post-call automation
        const existing = callSessionState.get(ccId)
        callSessionState.set(ccId, {
          bookedAppointment: existing?.bookedAppointment ?? false,
          contactId: existing?.contactId ?? null,
          appointmentId: existing?.appointmentId ?? null,
          escalated: true,
          escalationReason: reason,
        })

        return JSON.stringify({ transferred: true, transferred_to: 'owner', reason })
      } catch (err) {
        console.error('[tool-handlers] escalate_to_human error:', err)
        return JSON.stringify({ transferred: false, error: 'Unable to transfer call' })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
  },

  capture_referral_source: async (args, context) => {
    const source = typeof args['source'] === 'string' ? args['source'].trim() : ''
    if (!source) return { captured: false, error: 'No source provided' }

    const ccId = context.callControlId
    const session = ccId ? callSessionState.get(ccId) : null
    const contactId = session?.contactId

    if (!contactId) {
      console.info('[tool-handlers] capture_referral_source: no contactId in session — skipping')
      return { captured: false, reason: 'No contact linked to this call' }
    }

    const resultStr = await getMayaCircuitBreaker().wrap('capture_referral_source', async () => {
      try {
        const supabase = getSupabase()
        await supabase
          .from('contacts')
          .update({ referral_source_detail: source.slice(0, 200) })
          .eq('id', contactId)

        const { logActivity } = await import('../lib/activity.js')
        void logActivity({
          tenantId: context.tenantId,
          contactId,
          type: 'system',
          body: `Referral source captured by Maya: "${source}"`,
          actorType: 'ai',
        })

        console.info(
          `[tool-handlers] capture_referral_source: saved "${source}" for contact=${contactId}`
        )
        return JSON.stringify({ captured: true, source })
      } catch (err) {
        console.error('[tool-handlers] capture_referral_source error:', err)
        return JSON.stringify({ captured: false, error: 'Failed to save referral source' })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
  },

  get_appointments: async (_args, context) => {
    const contactId = context.callerContactId
    if (!contactId) {
      console.info('[tool-handlers] get_appointments: no callerContactId in context')
      return { found: false, message: 'No contact record found for this caller' }
    }

    const resultStr = await getMayaCircuitBreaker().wrap('get_appointments', async () => {
      try {
        const supabase = getSupabase()
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from('appointments')
          .select('id, title, start_time, end_time, status, notes')
          .eq('tenant_id', context.tenantId)
          .eq('contact_id', contactId)
          .in('status', ['scheduled', 'confirmed'])
          .gte('start_time', now)
          .order('start_time', { ascending: true })
          .limit(5)

        if (error) {
          console.error(`[tool-handlers] get_appointments error: ${error.message}`)
          return JSON.stringify({ found: false, error: 'Unable to look up appointments' })
        }

        if (!data || data.length === 0) {
          console.info(
            `[tool-handlers] get_appointments: no upcoming appointments for contact=${contactId}`
          )
          return JSON.stringify({
            found: false,
            message: 'No upcoming appointments found for this caller',
          })
        }

        console.info(
          `[tool-handlers] get_appointments: found ${data.length} appointments for contact=${contactId}`
        )
        return JSON.stringify({
          found: true,
          appointments: data.map((a) => ({
            id: a.id,
            title: a.title,
            start_time: a.start_time,
            end_time: a.end_time,
            status: a.status,
            notes: a.notes,
          })),
        })
      } catch (err) {
        console.error('[tool-handlers] get_appointments error:', err)
        return JSON.stringify({ found: false, error: 'Unable to look up appointments' })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
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

    // Return immediately, schedule hangup after 5s so farewell audio finishes playing
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
    }, 5000)

    return { ended: true, message: 'Call will end in 5 seconds' }
  },

  reschedule_appointment: async (args, context) => {
    const rawPhone = String(args['caller_phone'] ?? context.callerId ?? '')
    const callerPhone = normalizePhone(rawPhone)
    const newDate = String(args['new_date'] ?? '')
    const newStartTime = String(args['new_start_time'] ?? '')
    const reason = args['reason'] ? String(args['reason']) : undefined

    console.info(
      `[tool-handlers] reschedule_appointment: caller=${callerPhone} new_date=${newDate} new_start=${newStartTime} tenant=${context.tenantId}`
    )

    const resultStr = await getMayaCircuitBreaker().wrap('reschedule_appointment', async () => {
      try {
        const supabase = getSupabase()
        const digitsOnly = callerPhone.replace(/\+/, '')

        // Find contact by phone (E.164 then digits-only fallback)
        let { data: contact } = await supabase
          .from('contacts')
          .select('id, full_name, phone')
          .eq('tenant_id', context.tenantId)
          .eq('phone', callerPhone)
          .eq('is_archived', false)
          .maybeSingle()

        if (!contact) {
          ;({ data: contact } = await supabase
            .from('contacts')
            .select('id, full_name, phone')
            .eq('tenant_id', context.tenantId)
            .eq('phone', digitsOnly)
            .eq('is_archived', false)
            .maybeSingle())
        }

        if (!contact) {
          return JSON.stringify({
            rescheduled: false,
            message: 'No upcoming appointment found for this number',
          })
        }

        // Find next upcoming scheduled/confirmed appointment
        const { data: existing } = await supabase
          .from('appointments')
          .select('id, start_time, end_time, status')
          .eq('tenant_id', context.tenantId)
          .eq('contact_id', contact['id'])
          .in('status', ['scheduled', 'confirmed'])
          .gt('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (!existing) {
          return JSON.stringify({
            rescheduled: false,
            message: 'No upcoming appointment found for this number',
          })
        }

        // Cancel existing appointment
        const { error: cancelErr } = await supabase
          .from('appointments')
          .update({ status: 'canceled' })
          .eq('id', existing['id'])

        if (cancelErr) {
          console.error(
            `[tool-handlers] reschedule_appointment: cancel failed: ${cancelErr.message}`
          )
          return JSON.stringify({
            rescheduled: false,
            message: 'Failed to cancel existing appointment',
          })
        }

        // Book new appointment reusing existing handler
        const bookArgs: Record<string, unknown> = {
          date: newDate,
          start_time: newStartTime,
          caller_name: String(contact['full_name'] ?? ''),
          caller_phone: callerPhone,
        }
        if (reason) bookArgs['reason'] = reason

        const bookResult = await handlers['book_appointment']!(bookArgs, context)

        if (!bookResult['booked']) {
          return JSON.stringify({
            rescheduled: false,
            message: String(
              bookResult['error'] ??
                bookResult['message'] ??
                'Your appointment was cancelled but we were unable to book the new time. Someone will call you back to confirm.'
            ),
          })
        }

        return JSON.stringify({
          rescheduled: true,
          old_appointment_id: existing['id'],
          new_appointment_id: bookResult['appointment_id'] ?? null,
          new_start: bookResult['start'],
          new_end: bookResult['end'],
        })
      } catch (err) {
        console.error('[tool-handlers] reschedule_appointment error:', err)
        return JSON.stringify({ rescheduled: false, message: 'Unable to reschedule appointment' })
      }
    })
    return JSON.parse(resultStr) as Record<string, unknown>
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
