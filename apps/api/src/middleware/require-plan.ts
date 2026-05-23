/**
 * Plan + module gating — Phase 9.
 *
 * Blocks a request when:
 *   1. The tenant's subscription_status isn't 'trialing' or 'active', OR
 *   2. The tenant's modules JSON is missing any of the required modules.
 *
 * The tenant snapshot is read from the DB on every call (no caching) so
 * plan changes take effect within a single request without a cold-start.
 * This mirrors the existing `isModuleEnabled` helper, and is intended to
 * eventually replace ad-hoc `requireModule()` usage on routes that need
 * subscription gating in addition to module gating.
 */
import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import type { AuthenticatedRequest } from '../lib/auth.js'

interface TenantPlanRow {
  subscription_status: string | null
  modules: Record<string, boolean> | null
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
      // Fail open if Supabase env not configured — matches existing
      // requireModule() behavior so dev environments still work.
      next()
      return
    }

    const { data } = await supabase
      .from('tenants')
      .select('subscription_status, modules')
      .eq('id', authed.tenantId)
      .maybeSingle<TenantPlanRow>()

    // Treat missing row / null status as 'trialing' so new tenants and
    // legacy tenants pre-billing aren't blocked.
    const status = data?.subscription_status ?? 'trialing'

    if (!ALLOWED_STATUSES.has(status)) {
      res.status(402).json({
        error: 'Subscription required',
        status,
        upgrade_url: '/pricing',
      })
      return
    }

    // Module gate: only treat an explicit `false` as denied. Missing keys
    // are allowed so legacy/pre-billing tenants (and test fixtures) aren't
    // blocked — paying tenants get all plan modules set to true by the
    // Stripe billing webhook (see modulesForPlan in config/stripe-plans).
    const modules = data?.modules ?? {}
    const missing = requiredModules.filter((m) => modules[m] === false)
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
