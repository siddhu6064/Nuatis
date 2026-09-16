import type { Request, Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from './auth.js'

/**
 * The platform-owner gate: a designated internal tenant whose `owner` login is
 * trusted with cross-tenant internal work.
 *
 * Moved here from routes/admin-console.ts so platform incidents can reuse it.
 * Deliberately not a new auth mode — a tenant-less admin identity was already
 * considered and rejected when the admin console was built, and reintroducing
 * it for one feature would fork the platform's auth story.
 *
 * Fails closed when PLATFORM_TENANT_ID is unset or empty: an unconfigured
 * environment must not become an open door for whoever happens to have no
 * tenant id.
 */
export function requirePlatformOwner(req: Request, res: Response, next: NextFunction): void {
  const authed = req as AuthenticatedRequest
  const platformTenantId = process.env['PLATFORM_TENANT_ID']
  if (!platformTenantId || authed.tenantId !== platformTenantId || authed.role !== 'owner') {
    res.status(403).json({ error: 'Not authorized' })
    return
  }
  next()
}
