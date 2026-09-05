import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import redis from './redis.js'
import { getServiceClient } from './supabase.js'
import { verifyAuthjsToken } from './auth.js'

// Real "log in as this tenant" support access — read-write, unlike the
// existing read-only tenant-activity drill-down in admin-console.ts. Every
// session is fingerprinted (which platform admin, which tenant, why, when)
// in impersonation_sessions, and every mutating request made during the
// session is logged to impersonation_actions by a global middleware
// (see index.ts) keyed off the JWT's `impersonation` claim — no per-route
// wiring needed.

const EXCHANGE_TTL_SECONDS = 60
const SESSION_TTL_MINUTES = 30

export interface ImpersonationClaims {
  appUserId: string
  authjsUserId: string
  tenantId: string
  role: string
  email: string
  name: string
  vertical: string
  businessName: string
  subscriptionStatus: string
  modules: Record<string, boolean>
  impersonation: {
    sessionId: string
    platformUserId: string
    platformUserEmail: string
    expiresAt: string
  }
}

interface TenantInfo {
  id: string
  vertical: string
  name: string
  subscription_status: string
  modules: Record<string, boolean> | null
}

export async function startImpersonationSession(
  supabase: SupabaseClient,
  params: {
    platformUserId: string
    platformUserEmail: string
    targetTenantId: string
    reason: string
  }
): Promise<{ exchangeCode: string } | { error: string }> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, vertical, name, subscription_status, modules')
    .eq('id', params.targetTenantId)
    .single<TenantInfo>()
  if (!tenant) return { error: 'Tenant not found' }

  // Act as the target tenant's owner — the one role guaranteed to exist and
  // to already have full product access, so nothing in the target tenant's
  // own permission model needs to change for this to work.
  const { data: targetUser } = await supabase
    .from('users')
    .select('id, authjs_user_id, role, full_name, email')
    .eq('tenant_id', params.targetTenantId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle<{
      id: string
      authjs_user_id: string
      role: string
      full_name: string | null
      email: string | null
    }>()
  if (!targetUser) return { error: 'Target tenant has no active owner account to act as' }

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000)

  const { data: session, error } = await supabase
    .from('impersonation_sessions')
    .insert({
      platform_user_id: params.platformUserId,
      platform_user_email: params.platformUserEmail,
      target_tenant_id: params.targetTenantId,
      target_app_user_id: targetUser.id,
      reason: params.reason,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !session) return { error: 'Failed to start impersonation session' }

  const claims: ImpersonationClaims = {
    appUserId: targetUser.id,
    authjsUserId: targetUser.authjs_user_id,
    tenantId: tenant.id,
    role: targetUser.role,
    email: targetUser.email ?? '',
    name: targetUser.full_name ?? 'Tenant Owner',
    vertical: tenant.vertical,
    businessName: tenant.name,
    subscriptionStatus: tenant.subscription_status,
    modules: tenant.modules ?? {},
    impersonation: {
      sessionId: session.id,
      platformUserId: params.platformUserId,
      platformUserEmail: params.platformUserEmail,
      expiresAt: expiresAt.toISOString(),
    },
  }

  const exchangeCode = randomBytes(32).toString('hex')
  await redis.set(
    `impersonate-exchange:${exchangeCode}`,
    JSON.stringify(claims),
    'EX',
    EXCHANGE_TTL_SECONDS
  )

  return { exchangeCode }
}

export async function redeemImpersonationExchangeCode(
  exchangeCode: string
): Promise<ImpersonationClaims | null> {
  const key = `impersonate-exchange:${exchangeCode}`
  const raw = await redis.get(key)
  if (!raw) return null
  await redis.del(key)
  return JSON.parse(raw) as ImpersonationClaims
}

export async function endImpersonationSession(
  supabase: SupabaseClient,
  sessionId: string,
  platformUserId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('platform_user_id', platformUserId)
    .is('ended_at', null)
    .select('id')
    .maybeSingle()
  return !error && Boolean(data)
}

export async function logImpersonationAction(
  supabase: SupabaseClient,
  sessionId: string,
  method: string,
  path: string
): Promise<void> {
  try {
    await supabase.from('impersonation_actions').insert({ session_id: sessionId, method, path })
  } catch (err) {
    console.error('[impersonation] failed to log action:', err)
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Global fingerprint for every mutating request made during an impersonation
// session. Mounted app-level at /api, before the per-route routers — same
// shape as enforce-trial.ts's own early token peek, decoding the bearer
// token itself rather than depending on some route's own requireAuth having
// already run. Fails silent on any decode error: auditing must never block
// or break the actual request.
export async function impersonationAuditMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!MUTATING_METHODS.has(req.method)) {
    next()
    return
  }

  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = await verifyAuthjsToken(authHeader.slice(7))
      const sessionId = (payload['impersonation'] as { sessionId?: string } | undefined)?.sessionId
      if (sessionId) {
        void logImpersonationAction(getServiceClient(), sessionId, req.method, req.originalUrl)
      }
    } catch {
      // Decode failure — the route's own requireAuth will reject it if it
      // matters. Not this middleware's job.
    }
  }

  next()
}
