import { createHash } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { getServiceClient } from './supabase.js'
import { requireAuth, type AuthenticatedRequest } from './auth.js'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Accepts either a normal session JWT (requireAuth) or a tenant-scoped API
 * key via the `X-API-Key` header — a narrow, additional auth path for the
 * webhook-subscription-management endpoints only (not a general data API),
 * so a tenant can manage its subscriptions from a script without a browser
 * session.
 *
 * An API-key request has no real acting user — `role: 'api_key'` marks that
 * explicitly (not one of the normal owner/admin/manager/staff roles) so a
 * future `role === 'owner'` check can't accidentally treat it as more
 * privileged than intended. `userId`/`appUserId` are left empty/null the same
 * way an unauthenticated context would be: do NOT pass `authed.userId` from
 * an api-key-authed request into `actor_id`/`created_by`-style columns — the
 * exact class of bug this fixed elsewhere (see the proxy.ts fix) was an empty
 * string silently reaching a uuid column.
 */
export async function requireAuthOrApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key']

  if (typeof apiKey === 'string' && apiKey.length > 0) {
    const supabase = getServiceClient()
    const keyHash = hashApiKey(apiKey)

    const { data: row } = await supabase
      .from('api_keys')
      .select('id, tenant_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .maybeSingle()

    if (!row) {
      res.status(401).json({ error: 'Invalid or revoked API key' })
      return
    }

    void supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id as string)

    const authedReq = req as AuthenticatedRequest
    authedReq.tenantId = row.tenant_id as string
    authedReq.userId = ''
    authedReq.appUserId = null
    authedReq.role = 'api_key'
    authedReq.vertical = ''
    authedReq.authProvider = 'authjs'
    next()
    return
  }

  await requireAuth(req, res, next)
}
