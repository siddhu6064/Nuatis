import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AuthenticatedRequest extends Request {
  tenantId: string
  userId: string
  role: string
  vertical: string
  authProvider: 'authjs' | 'clerk'
}

async function verifyAuthjsToken(token: string): Promise<Record<string, unknown>> {
  const secret = process.env['AUTH_SECRET']
  if (!secret) throw new Error('AUTH_SECRET not set')
  const secretBytes = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, secretBytes, { algorithms: ['HS256'] })
  return payload as Record<string, unknown>
}

async function verifyClerkToken(token: string): Promise<Record<string, unknown>> {
  const clerkJwksUrl = process.env['CLERK_JWKS_URL']
  if (!clerkJwksUrl) throw new Error('CLERK_JWKS_URL not set')
  const JWKS = createRemoteJWKSet(new URL(clerkJwksUrl))
  const { payload } = await jwtVerify(token, JWKS, { algorithms: ['RS256'] })
  return payload as Record<string, unknown>
}

function getErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as Record<string, unknown>)['code'])
  }
  return ''
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization']

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' })
    return
  }

  const token = authHeader.slice(7)

  // Decode header to detect Clerk vs Auth.js
  let isClerk = false
  try {
    const [, rawPayload] = token.split('.')
    if (rawPayload) {
      const decoded = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf-8')) as Record<
        string,
        unknown
      >
      isClerk = !!decoded['azp']
    }
  } catch {
    // malformed token — will fail verification below
  }

  try {
    const payload = isClerk ? await verifyClerkToken(token) : await verifyAuthjsToken(token)

    const tenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined

    if (!tenantId) {
      res.status(401).json({ error: 'Token missing tenant context' })
      return
    }

    const authedReq = req as AuthenticatedRequest
    authedReq.tenantId = tenantId
    authedReq.userId = (payload['sub'] as string) ?? ''
    authedReq.role = (payload['role'] as string) ?? 'staff'
    authedReq.vertical = (payload['vertical'] as string) ?? ''
    authedReq.authProvider = isClerk ? 'clerk' : 'authjs'
    res.locals['tenantId'] = tenantId

    next()
  } catch (err: unknown) {
    const code = getErrorCode(err)

    if (code === 'ERR_JWT_EXPIRED') {
      res.status(401).json({ error: 'Token expired' })
      return
    }
    if (
      code === 'ERR_JWS_INVALID' ||
      code === 'ERR_JWT_INVALID' ||
      code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
      code === 'ERR_JWT_CLAIM_VALIDATION_FAILED'
    ) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    if (err instanceof Error && err.message === 'AUTH_SECRET not set') {
      res.status(500).json({ error: 'Server misconfigured' })
      return
    }

    res.status(401).json({ error: 'Authentication failed' })
  }
}
