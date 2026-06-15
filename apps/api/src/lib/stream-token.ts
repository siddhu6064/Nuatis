/**
 * Signed tokens for the Telnyx media-stream WebSocket (`/voice/stream`).
 *
 * The upgrade endpoint is reachable by anyone, so we bind each stream_url we
 * hand to Telnyx to a tenant + call with an HMAC-SHA256 token. Only the server
 * (which holds AUTH_SECRET) can mint a valid token, so an unauthenticated
 * client cannot open a stream and impersonate a tenant.
 *
 * The token covers a 5-minute window so it expires shortly after the call
 * connects; verification also accepts the previous window for clock skew.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const WINDOW_SECONDS = 300

function getSecret(): string {
  const secret = process.env['AUTH_SECRET']
  if (!secret) throw new Error('AUTH_SECRET not set — cannot sign stream tokens')
  return secret
}

function computeToken(tenantId: string, callControlId: string, window: number): string {
  return createHmac('sha256', getSecret())
    .update(`${tenantId}:${callControlId}:${window}`)
    .digest('hex')
}

/** HMAC token binding a media stream to a tenant + call, valid for a 5-minute window. */
export function signStreamToken(tenantId: string, callControlId: string): string {
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS)
  return computeToken(tenantId, callControlId, window)
}

/** Verify a stream token against the current and previous window (clock-skew tolerant). */
export function verifyStreamToken(token: string, tenantId: string, callControlId: string): boolean {
  if (!token || !tenantId || !callControlId) return false
  const current = Math.floor(Date.now() / 1000 / WINDOW_SECONDS)
  for (const window of [current, current - 1]) {
    const expected = computeToken(tenantId, callControlId, window)
    const expectedBuf = Buffer.from(expected, 'hex')
    const tokenBuf = Buffer.from(token, 'hex')
    if (expectedBuf.length === tokenBuf.length && timingSafeEqual(expectedBuf, tokenBuf)) {
      return true
    }
  }
  return false
}

/**
 * Append a signed stream token (plus the tenant + call ids needed to verify it)
 * to a base stream URL. Telnyx connects to the exact URL we return, query string
 * included, so the upgrade handler can re-derive and check the token.
 */
export function buildSignedStreamUrl(
  baseUrl: string,
  tenantId: string,
  callControlId: string
): string {
  const url = new URL(baseUrl)
  url.searchParams.set('st', signStreamToken(tenantId, callControlId))
  url.searchParams.set('t', tenantId)
  url.searchParams.set('cci', callControlId)
  return url.toString()
}
