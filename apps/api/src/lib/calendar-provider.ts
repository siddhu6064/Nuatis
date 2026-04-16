import { createClient } from '@supabase/supabase-js'
import { getCalendarClient } from '../services/google.js'
import {
  getValidOutlookCalendarToken,
  checkOutlookAvailability,
  createOutlookEvent,
} from './outlook-calendar.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarCredentials {
  provider: 'google' | 'outlook'
  refreshToken: string
  calendarId: string
  timezone: string
}

// ── Supabase helper ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Credentials lookup ────────────────────────────────────────────────────────

/**
 * Fetch calendar credentials for a tenant, routing to Google or Outlook.
 *
 * Resolution order:
 *  1. Check tenant.calendar_provider ('google' | 'outlook')
 *  2. If 'outlook': use tenant's outlook_calendar tokens
 *  3. If 'google' (or null): look up locations table for google_refresh_token
 *     (backwards-compat: if locations has a token but calendar_provider is null,
 *      treat as 'google')
 *  4. Return null if no calendar is connected.
 */
export async function getCalendarCredentials(
  tenantId: string
): Promise<CalendarCredentials | null> {
  const supabase = getSupabase()

  const [tenantResult, locationResult] = await Promise.all([
    supabase
      .from('tenants')
      .select('calendar_provider, timezone, outlook_calendar_refresh_token')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('locations')
      .select('google_refresh_token, google_calendar_id')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .maybeSingle(),
  ])

  const tenant = tenantResult.data as {
    calendar_provider?: string | null
    timezone?: string | null
    outlook_calendar_refresh_token?: string | null
  } | null

  const location = locationResult.data as {
    google_refresh_token?: string | null
    google_calendar_id?: string | null
  } | null

  const timezone: string = tenant?.timezone ?? 'America/Chicago'
  const provider = tenant?.calendar_provider as 'google' | 'outlook' | null | undefined

  // Outlook path
  if (provider === 'outlook') {
    if (!tenant?.outlook_calendar_refresh_token) return null
    return {
      provider: 'outlook',
      // refreshToken is stored encrypted; getValidOutlookCalendarToken handles decryption
      refreshToken: tenant.outlook_calendar_refresh_token,
      calendarId: 'primary', // Outlook uses the default calendar
      timezone,
    }
  }

  // Google path (explicit or backwards-compat fallback)
  if (location?.google_refresh_token) {
    return {
      provider: 'google',
      refreshToken: location.google_refresh_token,
      calendarId: (location.google_calendar_id as string | null) ?? 'primary',
      timezone,
    }
  }

  return null
}

// ── Availability ──────────────────────────────────────────────────────────────

/**
 * Return busy periods for a tenant's connected calendar between two ISO datetimes.
 */
export async function checkCalendarAvailability(
  tenantId: string,
  dateStart: string,
  dateEnd: string
): Promise<Array<{ start: string; end: string }>> {
  const creds = await getCalendarCredentials(tenantId)
  if (!creds) return []

  if (creds.provider === 'outlook') {
    const accessToken = await getValidOutlookCalendarToken(tenantId)
    return checkOutlookAvailability(accessToken, dateStart, dateEnd, creds.timezone)
  }

  // Google FreeBusy
  const calendar = getCalendarClient(creds.refreshToken)
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: dateStart,
      timeMax: dateEnd,
      items: [{ id: creds.calendarId }],
    },
  })

  const busy = freeBusy.data.calendars?.[creds.calendarId]?.busy ?? []
  return busy.map((b) => ({ start: b.start ?? '', end: b.end ?? '' }))
}

// ── Event creation ────────────────────────────────────────────────────────────

/**
 * Create a calendar appointment for a tenant. Routes to Google or Outlook.
 * Returns { eventId } on success, null if no calendar is connected.
 */
export async function createCalendarAppointment(
  tenantId: string,
  event: {
    title: string
    startIso: string
    endIso: string
    description?: string
    attendees?: Array<{ email: string; name?: string }>
  }
): Promise<{ eventId: string } | null> {
  const creds = await getCalendarCredentials(tenantId)
  if (!creds) return null

  if (creds.provider === 'outlook') {
    const accessToken = await getValidOutlookCalendarToken(tenantId)
    const result = await createOutlookEvent(accessToken, {
      subject: event.title,
      start: event.startIso,
      end: event.endIso,
      timezone: creds.timezone,
      body: event.description,
      attendees: event.attendees,
    })
    return { eventId: result.id }
  }

  // Google Calendar
  const calendar = getCalendarClient(creds.refreshToken)
  const googleEvent = await calendar.events.insert({
    calendarId: creds.calendarId,
    requestBody: {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.startIso, timeZone: creds.timezone },
      end: { dateTime: event.endIso, timeZone: creds.timezone },
      attendees: event.attendees?.map((a) => ({ email: a.email, displayName: a.name })),
    },
  })

  return { eventId: googleEvent.data.id ?? '' }
}
