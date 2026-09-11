import { NextResponse } from 'next/server'
import { POS_COOKIE, serializePosSession } from '@nuatis/pos-web'

const API_BACKEND = process.env.API_BACKEND_URL ?? 'http://localhost:3001'

/** Matches the 12h expiry the API stamps on the terminal token. */
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

/**
 * Exchanges a PIN for a register session.
 *
 * Runs server-side so the PIN never leaves this process and the returned token
 * never enters a client bundle. The cookie is httpOnly, so an XSS bug — in a
 * menu item name, say — cannot read a working register credential out of the
 * browser.
 *
 * The proxy (@nuatis/pos-web) deliberately does not gate /api/session: this is
 * how a register gets a session in the first place. It does still CSRF-check
 * it, since this is a state-mutating POST that sets a cookie.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const tenantId = typeof body['tenant_id'] === 'string' ? body['tenant_id'] : ''
  const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
  const pin = typeof body['pin'] === 'string' ? body['pin'] : ''

  if (!tenantId || !locationId || !pin) {
    return NextResponse.json(
      { error: 'tenant_id, location_id and pin are required' },
      { status: 400 }
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(`${API_BACKEND}/api/pos/terminal/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, location_id: locationId, pin }),
    })
  } catch {
    // The API being unreachable is an outage, not a bad PIN. Saying so stops a
    // cashier retyping a correct PIN at a dead backend.
    return NextResponse.json({ error: 'Cannot reach the server' }, { status: 503 })
  }

  if (!upstream.ok) {
    // Pass the API's deliberately uniform rejection straight through.
    // Distinguishing "wrong PIN" from "unknown tenant" here would rebuild the
    // enumeration oracle the API route was careful not to be.
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
  }

  const data = (await upstream.json()) as {
    token: string
    staff: { id: string; name: string | null }
    locationId: string
  }

  // Response body carries the staff name for the header and nothing else — in
  // particular, never the token.
  const res = NextResponse.json({ staff: data.staff, locationId: data.locationId })

  res.cookies.set(
    POS_COOKIE,
    serializePosSession({
      token: data.token,
      tenantId,
      locationId: data.locationId,
      staffId: data.staff.id,
      staffName: data.staff.name,
      expiresAt: Date.now() + TWELVE_HOURS_MS,
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: TWELVE_HOURS_MS / 1000,
    }
  )
  return res
}

/** Sign out — clears the register session. */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(POS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
