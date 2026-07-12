import type { Request, Response, NextFunction } from 'express'
import { jwtVerify } from 'jose'
import { createClient } from '@supabase/supabase-js'

export interface AuthenticatedRequest extends Request {
  tenantId: string
  userId: string
  /** public.users.id — the domain UUID that FKs reference. Resolved from
   *  public.users WHERE authjs_user_id = token.sub. Null if not found. */
  appUserId: string | null
  role: string
  vertical: string
  authProvider: 'authjs'
}

function getAppUserIdCache(): Map<string, string> {
  const g = globalThis as typeof globalThis & { __appUserIdCache?: Map<string, string> }
  if (!g.__appUserIdCache) g.__appUserIdCache = new Map()
  return g.__appUserIdCache
}

async function resolveAppUserId(sub: string, tenantId: string): Promise<string | null> {
  const cache = getAppUserIdCache()
  const cacheKey = `${tenantId}:${sub}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null

  const supabase = createClient(url, key)

  let timerHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timerHandle = setTimeout(() => {
      console.warn('[auth] resolveAppUserId timed out after 2s — proceeding without appUserId')
      resolve(null)
    }, 2000)
    // unref so this timer never prevents the process from exiting cleanly
    timerHandle.unref()
  })

  const lookup: Promise<string | null> = Promise.resolve(
    supabase
      .from('users')
      .select('id')
      .eq('authjs_user_id', sub)
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
  ).then(
    (result) => (result.data as { id: string } | null)?.id ?? null,
    (_err: unknown) => {
      console.warn('[auth] resolveAppUserId error:', _err)
      return null
    }
  )

  const appUserId = await Promise.race([lookup, timeout])
  // Always clear — no-op if timer already fired, cancels it if lookup won
  clearTimeout(timerHandle)

  // Only cache a real id — null stays uncached so a later request can retry
  if (appUserId) cache.set(cacheKey, appUserId)
  return appUserId
}

export async function verifyAuthjsToken(token: string): Promise<Record<string, unknown>> {
  const secret = process.env['AUTH_SECRET']
  if (!secret) throw new Error('AUTH_SECRET not set')
  const secretBytes = new TextEncoder().encode(secret)
  // iss/aud binding: only tokens minted by our web proxy or the mobile login
  // endpoint for this API are accepted, even if another system shares the
  // secret. (RS256 key split is a deferred follow-up.)
  const { payload } = await jwtVerify(token, secretBytes, {
    algorithms: ['HS256'],
    issuer: ['nuatis-web', 'nuatis-mobile'],
    audience: 'nuatis-api',
  })
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

  try {
    const payload = await verifyAuthjsToken(token)

    const tenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined

    if (!tenantId) {
      res.status(401).json({ error: 'Token missing tenant context' })
      return
    }

    const authedReq = req as AuthenticatedRequest
    const sub = (payload['sub'] as string) ?? ''
    const claimedAppUserId = (payload['appUserId'] as string) || null
    authedReq.tenantId = tenantId
    authedReq.userId = sub
    // Fast path: appUserId was embedded at login time (tokens issued after the
    // authjs.ts change carry this claim). Fall back to DB lookup for older tokens.
    authedReq.appUserId = claimedAppUserId ?? (sub ? await resolveAppUserId(sub, tenantId) : null)
    authedReq.role = (payload['role'] as string) ?? 'staff'
    authedReq.vertical = (payload['vertical'] as string) ?? ''
    authedReq.authProvider = 'authjs'
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

/**
 * Role gate. Must run AFTER requireAuth (which populates `req.role`, defaulting
 * to 'staff'). Returns 403 unless the caller's role is in `roles`.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as AuthenticatedRequest
    if (!authed.role) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!roles.includes(authed.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}

export function requireModule(moduleName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authed = req as AuthenticatedRequest
    // Module check: fetch tenant modules from DB
    const supabaseUrl = process.env['SUPABASE_URL']
    const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!supabaseUrl || !supabaseKey) {
      // Fail closed — without the module check we cannot confirm entitlement
      // (mirrors require-plan.ts).
      res.status(503).json({ error: 'Module check unavailable' })
      return
    }
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data } = await supabase
      .from('tenants')
      .select('modules')
      .eq('id', authed.tenantId)
      .single<{ modules: Record<string, boolean> | null }>()
    const modules = data?.modules ?? {}
    if (modules[moduleName] === false) {
      res.status(403).json({ error: `Module '${moduleName}' is not enabled for your account` })
      return
    }
    next()
  }
}
