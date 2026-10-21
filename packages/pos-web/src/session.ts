/**
 * The register's session, stored in an httpOnly cookie.
 *
 * The API token inside this is minted by POST /api/pos/terminal/sign-in and
 * lives 12 hours. It is deliberately NOT readable from JavaScript: the cookie
 * is httpOnly and the proxy attaches the token server-side, so an XSS bug in a
 * menu name cannot exfiltrate a working register credential.
 *
 * This differs from apps/web, which has an Auth.js session and mints a fresh
 * 60s JWT per request. A register has no Auth.js session — a cashier signs in
 * with a PIN — so the long-lived token has to be stored somewhere, and an
 * httpOnly cookie is the only place the browser cannot read it from.
 */
export const POS_COOKIE = 'nuatis_pos_session'

export interface PosSession {
  token: string
  tenantId: string
  locationId: string
  staffId: string
  staffName: string | null
  /** Epoch ms. Mirrors the JWT's own exp, so the proxy can redirect to the PIN
   *  screen before the API would start 401ing mid-service. */
  expiresAt: number
}

export function serializePosSession(s: PosSession): string {
  return JSON.stringify(s)
}

/**
 * Parse the cookie into a session, or null if it is absent or malformed.
 *
 * Every field is checked rather than trusted: the value is attacker-influenced
 * in the sense that anything could be sent in a cookie header, and a malformed
 * one must produce "no session" rather than a half-built object that later
 * puts `undefined` into an Authorization header.
 */
export function readPosSession(cookieValue: string | undefined): PosSession | null {
  if (!cookieValue) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(cookieValue)
  } catch {
    return null
  }

  // Arrays are objects too, and `typeof null === 'object'` — exclude both.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const o = parsed as Record<string, unknown>
  if (
    typeof o['token'] !== 'string' ||
    typeof o['tenantId'] !== 'string' ||
    typeof o['locationId'] !== 'string' ||
    typeof o['staffId'] !== 'string' ||
    typeof o['expiresAt'] !== 'number'
  ) {
    return null
  }

  // Rebuilt field by field rather than spread, so an attacker-supplied extra
  // key cannot ride along into anything downstream that iterates the object.
  return {
    token: o['token'],
    tenantId: o['tenantId'],
    locationId: o['locationId'],
    staffId: o['staffId'],
    // A missing or odd display name is cosmetic — do not invalidate a
    // working session over it.
    staffName: typeof o['staffName'] === 'string' ? o['staffName'] : null,
    expiresAt: o['expiresAt'],
  }
}

/** The boundary counts as expired — never hand a token to the API on its last ms. */
export function isExpired(s: PosSession, now: number = Date.now()): boolean {
  return now >= s.expiresAt
}
