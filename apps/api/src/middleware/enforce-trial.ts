/**
 * Self-serve trial enforcement — READ-ONLY mode after the grace window.
 *
 * Mounted app-level at /api, after generalLimiter and before the routers.
 * It peeks at the Bearer token itself (requireAuth runs later, per-route,
 * and stays authoritative for auth) purely to answer "is this tenant's
 * trial over." Safe methods always pass; unsafe methods 402 once the
 * trial + grace window is gone, except for the exempt prefixes a locked
 * tenant still needs (paying, signing in, webhooks, data export).
 *
 * FAIL OPEN, unlike every other gate in this codebase: a missing header,
 * a bad signature, a token without a tenantId, a Supabase timeout or a
 * missing row all ALLOW the request. Locking a small business out of
 * their own phone line over a DB blip is worse than three extra days of
 * free access. Unauthenticated requests then die at each route's own
 * requireAuth exactly as they do today.
 */
import type { Request, Response, NextFunction } from 'express'
import { verifyAuthjsToken } from '../lib/auth.js'
import { getTrialExpired, getCachedTrialEndsAt } from '../lib/trial-cache.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Paths are relative to the /api mount — Express strips the mount prefix,
// so req.path here is e.g. '/billing/checkout', not '/api/billing/checkout'.
// NOTE: '/webhooks' (the authed tenant webhook-CRUD router) is deliberately
// NOT exempt — a read-only tenant should not be creating outbound webhook
// subscriptions.
const EXEMPT_PREFIXES = [
  '/billing', // checkout + portal — how they pay
  '/auth', // google, mobile — they mint tokens
  '/webhooks/stripe',
  '/webhooks/email',
  '/webhooks/email-inbound',
  '/settings/data-export', // they must be able to get their data out
]

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
}

export async function enforceTrial(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }
  if (isExempt(req.path)) {
    next()
    return
  }

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    next()
    return
  }

  let tenantId: string | undefined
  try {
    const payload = await verifyAuthjsToken(authHeader.slice(7))
    tenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined
  } catch {
    next()
    return
  }
  if (!tenantId) {
    next()
    return
  }

  const expired = await getTrialExpired(tenantId)
  if (!expired) {
    next()
    return
  }

  res.status(402).json({
    error: 'Trial ended',
    trial_ended_at: getCachedTrialEndsAt(tenantId),
    upgrade_url: '/pricing',
    read_only: true,
  })
}
