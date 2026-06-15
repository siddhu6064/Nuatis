/**
 * Plan + module gating — Phase 9.
 *
 * Blocks a request when:
 *   1. The tenant's subscription_status isn't 'trialing' or 'active'
 *      (null/missing status is NOT treated as trialing — it blocks), OR
 *   2. A required module is not entitled — computed the same way as
 *      isModuleEnabled: an explicit boolean on tenants.modules wins, else
 *      defaultEntitlement(module, plan, product) derives access from the tier.
 *
 * The tenant snapshot is read from the DB on every call (no caching) so
 * plan changes take effect within a single request without a cold-start.
 * Fails CLOSED: if the billing check can't run (Supabase env missing) the
 * request is rejected with 503 rather than allowed through.
 */
import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import type { AuthenticatedRequest } from '../lib/auth.js'
import { defaultEntitlement } from '../config/stripe-plans.js'

interface TenantPlanRow {
  subscription_status: string | null
  subscription_plan: string | null
  modules: Record<string, boolean> | null
  product: string | null
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return createClient(url, key)
}

const ALLOWED_STATUSES = new Set(['trialing', 'active'])

export function requirePlan(...requiredModules: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    if (!supabase) {
      // Fail closed — without the billing check we cannot confirm entitlement.
      res.status(503).json({ error: 'Billing check unavailable' })
      return
    }

    const { data } = await supabase
      .from('tenants')
      .select('subscription_status, subscription_plan, modules, product')
      .eq('id', authed.tenantId)
      .maybeSingle<TenantPlanRow>()

    // Null/missing status, or any status outside the allow-list, blocks.
    const status = data?.subscription_status ?? null
    if (!status || !ALLOWED_STATUSES.has(status)) {
      res.status(402).json({
        error: 'Subscription required',
        status,
        upgrade_url: '/pricing',
      })
      return
    }

    // Module gate: explicit boolean override wins, else derive from the tier.
    const modules = data?.modules ?? {}
    const plan = data?.subscription_plan ?? null
    const product = data?.product ?? null
    const missing = requiredModules.filter((m) => {
      const v = modules[m]
      const allowed = typeof v === 'boolean' ? v : defaultEntitlement(m, plan, product)
      return !allowed
    })
    if (missing.length > 0) {
      res.status(402).json({
        error: 'Plan upgrade required',
        missing_modules: missing,
        upgrade_url: '/pricing',
      })
      return
    }

    next()
  }
}
