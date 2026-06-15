/**
 * Shared JWT mint for tests that exercise the real requireAuth.
 *
 * requireAuth (lib/auth.ts) requires iss ∈ {nuatis-web, nuatis-mobile} and
 * aud = nuatis-api, so every test token needs the claims. Defaults mirror the
 * web proxy's mint; pass issuer/audience: null to OMIT a claim for negative
 * tests, or a string to override it.
 *
 * NOT a test file — lives under __test-support__ so Jest's testMatch
 * ('**\/*.test.ts') does not pick it up.
 */
import { SignJWT, type JWTPayload } from 'jose'

export const TEST_JWT_ISSUER = 'nuatis-web'
export const TEST_JWT_AUDIENCE = 'nuatis-api'

export interface MintTestTokenOptions {
  secret?: string
  expiresIn?: string
  issuer?: string | null
  audience?: string | null
}

export async function mintTestToken(
  payload: JWTPayload,
  opts: MintTestTokenOptions = {}
): Promise<string> {
  const secret = opts.secret ?? process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
  if (opts.issuer !== null) jwt.setIssuer(opts.issuer ?? TEST_JWT_ISSUER)
  if (opts.audience !== null) jwt.setAudience(opts.audience ?? TEST_JWT_AUDIENCE)
  return jwt.sign(new TextEncoder().encode(secret))
}
