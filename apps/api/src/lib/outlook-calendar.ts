import { createClient } from '@supabase/supabase-js'
import { encryptToken, decryptToken } from './email-oauth.js'

// ── Supabase helper ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const CALENDAR_SCOPES = 'Calendars.ReadWrite User.Read offline_access'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes

// ── Auth URL ──────────────────────────────────────────────────────────────────

/**
 * Build Microsoft OAuth2 URL for calendar access.
 */
export function getOutlookCalendarAuthUrl(tenantId: string): string {
  const clientId = process.env['OUTLOOK_CLIENT_ID']
  if (!clientId) throw new Error('OUTLOOK_CLIENT_ID not set')

  const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
  const redirectUri = `${apiUrl}/api/calendar/outlook/callback`

  const state = Buffer.from(JSON.stringify({ tenantId }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: CALENDAR_SCOPES,
    response_mode: 'query',
    state,
  })

  return `${MS_AUTH_ENDPOINT}?${params.toString()}`
}

// ── Token exchange ────────────────────────────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeOutlookCalendarCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const clientId = process.env['OUTLOOK_CLIENT_ID']
  const clientSecret = process.env['OUTLOOK_CLIENT_SECRET']
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth env vars not set')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: CALENDAR_SCOPES,
  })

  const res = await fetch(MS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook calendar code exchange failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

/**
 * Refresh the Outlook calendar access token for a tenant.
 * Fetches encrypted refresh token from DB, decrypts, refreshes, re-encrypts, and saves.
 * Returns the fresh decrypted access_token.
 */
export async function refreshOutlookCalendarToken(tenantId: string): Promise<string> {
  const clientId = process.env['OUTLOOK_CLIENT_ID']
  const clientSecret = process.env['OUTLOOK_CLIENT_SECRET']
  if (!clientId || !clientSecret) throw new Error('Outlook OAuth env vars not set')

  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('outlook_calendar_refresh_token')
    .eq('id', tenantId)
    .single()

  if (error || !tenant) throw new Error(`Tenant not found: ${tenantId}`)

  const encryptedRefreshToken = (tenant as { outlook_calendar_refresh_token?: string | null })
    .outlook_calendar_refresh_token
  if (!encryptedRefreshToken)
    throw new Error(`No Outlook calendar refresh token for tenant ${tenantId}`)

  const refreshToken = decryptToken(encryptedRefreshToken)

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: CALENDAR_SCOPES,
  })

  const res = await fetch(MS_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook calendar token refresh failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  const encryptedAccessToken = encryptToken(data.access_token)

  const updatePayload: Record<string, string> = {
    outlook_calendar_access_token: encryptedAccessToken,
    outlook_calendar_token_expires_at: expiresAt,
  }
  // MS may rotate the refresh token
  if (data.refresh_token) {
    updatePayload['outlook_calendar_refresh_token'] = encryptToken(data.refresh_token)
  }

  const { error: updateError } = await supabase
    .from('tenants')
    .update(updatePayload)
    .eq('id', tenantId)

  if (updateError)
    throw new Error(`Failed to update Outlook calendar tokens: ${updateError.message}`)

  console.info(`[outlook-calendar] refreshed calendar token for tenant=${tenantId}`)
  return data.access_token
}

// ── Get valid token ───────────────────────────────────────────────────────────

/**
 * Return a valid decrypted Outlook calendar access_token for a tenant.
 * Auto-refreshes if the token is within 5 minutes of expiry.
 */
export async function getValidOutlookCalendarToken(tenantId: string): Promise<string> {
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('outlook_calendar_access_token, outlook_calendar_token_expires_at')
    .eq('id', tenantId)
    .single()

  if (error || !tenant) throw new Error(`Tenant not found: ${tenantId}`)

  const t = tenant as {
    outlook_calendar_access_token?: string | null
    outlook_calendar_token_expires_at?: string | null
  }

  if (!t.outlook_calendar_access_token) {
    // No access token stored — force a refresh
    return refreshOutlookCalendarToken(tenantId)
  }

  const expiresAt = t.outlook_calendar_token_expires_at
    ? new Date(t.outlook_calendar_token_expires_at).getTime()
    : 0

  if (expiresAt - Date.now() <= REFRESH_BUFFER_MS) {
    console.info(`[outlook-calendar] token expiring soon for tenant=${tenantId}, refreshing…`)
    return refreshOutlookCalendarToken(tenantId)
  }

  return decryptToken(t.outlook_calendar_access_token)
}

// ── Calendar API calls ────────────────────────────────────────────────────────

/**
 * Return busy periods from Outlook Calendar for a date range.
 */
export async function checkOutlookAvailability(
  accessToken: string,
  dateStart: string,
  dateEnd: string,
  timezone: string
): Promise<Array<{ start: string; end: string }>> {
  const url =
    `https://graph.microsoft.com/v1.0/me/calendarView` +
    `?startDateTime=${encodeURIComponent(dateStart)}&endDateTime=${encodeURIComponent(dateEnd)}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${timezone}"`,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook calendarView failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    value: Array<{ start: { dateTime: string }; end: { dateTime: string } }>
  }

  return (data.value ?? []).map((ev) => ({
    start: ev.start.dateTime,
    end: ev.end.dateTime,
  }))
}

/**
 * Create an event in Outlook Calendar and return its ID.
 */
export async function createOutlookEvent(
  accessToken: string,
  event: {
    subject: string
    start: string
    end: string
    timezone: string
    body?: string
    attendees?: Array<{ email: string; name?: string }>
  }
): Promise<{ id: string }> {
  const requestBody: Record<string, unknown> = {
    subject: event.subject,
    start: { dateTime: event.start, timeZone: event.timezone },
    end: { dateTime: event.end, timeZone: event.timezone },
  }

  if (event.body) {
    requestBody['body'] = { contentType: 'Text', content: event.body }
  }

  if (event.attendees && event.attendees.length > 0) {
    requestBody['attendees'] = event.attendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name ?? a.email },
      type: 'required',
    }))
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook event creation failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { id: string }
  return { id: data.id }
}
