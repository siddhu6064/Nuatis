import { createClient } from '@supabase/supabase-js'
import { defaultEntitlement } from '../config/stripe-plans.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Shared entitlement math for module gating.
 *
 * Used by both `isModuleEnabled()` (inline route-handler checks — entitlement
 * only) and `requirePlan()` (router-level middleware — entitlement PLUS a
 * separate subscription_status check). Reads tenants.modules /
 * subscription_plan / product fresh from the DB on every call (no caching)
 * and computes whether `moduleId` is enabled for `tenantId`:
 *   - an explicitly stored boolean on tenants.modules[moduleId] wins (true OR
 *     false — toggle / comp override), else
 *   - defaultEntitlement(moduleId, plan, product) derives access from tier.
 *
 * Deliberately does NOT decide anything about subscription_status or HTTP
 * status codes — that stays owned by each caller. Also deliberately does NOT
 * decide what to do when tenants.modules itself is null/missing (unprovisioned
 * tenant or query error) — callers differ here today (isModuleEnabled fails
 * closed to maya-only in that case, requirePlan does not), so `modulesPresent`
 * is surfaced for callers to apply their own policy.
 */
export interface EntitlementResolution {
  /** Explicit boolean stored on tenants.modules[moduleId], if any. */
  explicit: boolean | undefined
  /** Whether tenants.modules itself was a non-null/undefined record. */
  modulesPresent: boolean
  /** defaultEntitlement(moduleId, plan, product) — used when no explicit override. */
  defaultEnabled: boolean
  /** explicit ?? defaultEnabled — the module-entitlement verdict. */
  enabled: boolean
}

export async function resolveEntitlement(
  tenantId: string,
  moduleId: string
): Promise<EntitlementResolution> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('tenants')
    .select('modules, subscription_plan, product')
    .eq('id', tenantId)
    .maybeSingle()

  const modules = data?.modules as Record<string, boolean> | null | undefined
  const modulesPresent = !!modules

  const explicit = modules ? modules[moduleId] : undefined
  const plan = (data?.subscription_plan as string | null) ?? null
  const product = (data?.product as string | null) ?? null
  const defaultEnabled = defaultEntitlement(moduleId, plan, product)
  const enabled = typeof explicit === 'boolean' ? explicit : defaultEnabled

  return { explicit, modulesPresent, defaultEnabled, enabled }
}

export async function isModuleEnabled(tenantId: string, module: string): Promise<boolean> {
  const { modulesPresent, enabled } = await resolveEntitlement(tenantId, module)
  // Unprovisioned tenant or query error (modules null) → fail closed to maya-only.
  if (!modulesPresent) return module === 'maya'
  return enabled
}
