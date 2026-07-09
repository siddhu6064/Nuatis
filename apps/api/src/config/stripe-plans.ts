/**
 * Nuatis SaaS pricing tiers — Phase 9.
 *
 * Prices are stored in cents (Stripe convention). Module lists drive
 * feature-gating at the API + UI layer. Stripe price IDs are read from
 * env vars so the same code ships through dev/staging/prod without edits.
 *
 * Overage: Core + Pro charge per-minute over included Maya minutes via a
 * metered Stripe subscription item. Scale is unlimited (no overage).
 */
export const PLANS = {
  core: {
    name: 'Core',
    monthlyPrice: 149_00,
    annualPrice: 1_490_00,
    mayaMinutes: 300 as number | null,
    overageRate: 0.05 as number | null,
    modules: ['maya', 'crm', 'scheduling', 'appointments', 'pipeline'],
    stripePriceIdMonthly: process.env['STRIPE_PRICE_CORE_MONTHLY'] ?? '',
    stripePriceIdAnnual: process.env['STRIPE_PRICE_CORE_ANNUAL'] ?? '',
    stripeOveragePriceId: process.env['STRIPE_PRICE_CORE_OVERAGE'] ?? '',
  },
  pro: {
    name: 'Pro',
    monthlyPrice: 299_00,
    annualPrice: 2_990_00,
    mayaMinutes: 600 as number | null,
    overageRate: 0.04 as number | null,
    modules: [
      'maya',
      'crm',
      'scheduling',
      'appointments',
      'pipeline',
      'automation',
      'insights',
      'campaigns',
    ],
    stripePriceIdMonthly: process.env['STRIPE_PRICE_PRO_MONTHLY'] ?? '',
    stripePriceIdAnnual: process.env['STRIPE_PRICE_PRO_ANNUAL'] ?? '',
    stripeOveragePriceId: process.env['STRIPE_PRICE_PRO_OVERAGE'] ?? '',
  },
  scale: {
    name: 'Scale',
    monthlyPrice: 499_00,
    annualPrice: 4_990_00,
    // null = unlimited Maya minutes
    mayaMinutes: null as number | null,
    // null = no overage billing
    overageRate: null as number | null,
    modules: [
      'maya',
      'crm',
      'scheduling',
      'appointments',
      'pipeline',
      'automation',
      'insights',
      'campaigns',
      'cpq',
    ],
    stripePriceIdMonthly: process.env['STRIPE_PRICE_SCALE_MONTHLY'] ?? '',
    stripePriceIdAnnual: process.env['STRIPE_PRICE_SCALE_ANNUAL'] ?? '',
    stripeOveragePriceId: null as string | null,
  },
} as const

export type PlanKey = keyof typeof PLANS
export type PlanDef = (typeof PLANS)[PlanKey]

export const PLAN_KEYS: PlanKey[] = ['core', 'pro', 'scale']

// The full suite module set (scale's module list). upgrade-to-suite writes an
// explicit boolean for every one of these keys so downstream gates never have
// to resolve an absent key.
export const SUITE_MODULE_KEYS: readonly string[] = PLANS.scale.modules

/**
 * Reverse-lookup a plan key from any of its Stripe price IDs (monthly,
 * annual, or overage). Used by the webhook handler to identify which
 * plan a subscription belongs to from the line items.
 */
export function planKeyFromPriceId(priceId: string): PlanKey | null {
  if (!priceId) return null
  for (const key of PLAN_KEYS) {
    const p = PLANS[key]
    if (
      priceId === p.stripePriceIdMonthly ||
      priceId === p.stripePriceIdAnnual ||
      (p.stripeOveragePriceId && priceId === p.stripeOveragePriceId)
    ) {
      return key
    }
  }
  return null
}

/**
 * Returns the modules JSON object that should be stored on tenants.modules
 * for the given plan key — all modules in the plan set to true.
 */
export function modulesForPlan(plan: PlanKey): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const m of PLANS[plan].modules) out[m] = true
  return out
}

/**
 * Canonical entitlement model used by the API gates (isModuleEnabled +
 * requirePlan). Derives access from plan/product instead of relying on
 * explicitly-stored flags, so an absent key fails CLOSED for tier-gated
 * modules rather than open.
 */
// Suite base features — available to any provisioned (non-maya_only) tenant.
export const BASE_SUITE = new Set([
  'maya',
  'crm',
  'scheduling',
  'appointments',
  'pipeline',
  'companies',
  'deals',
])

// Tier-gated features — only available when the tenant's plan includes them.
export const TIER_GATED = new Set(['automation', 'insights', 'campaigns', 'cpq'])

/**
 * Default entitlement for a module given the tenant's plan + product, used
 * when no explicit boolean override is stored on tenants.modules.
 */
export function defaultEntitlement(
  module: string,
  plan: string | null,
  product: string | null
): boolean {
  if (product === 'maya_only') return module === 'maya' // maya_only = maya only
  if (BASE_SUITE.has(module)) return true // suite base features
  if (TIER_GATED.has(module)) {
    const p = plan && PLANS[plan as PlanKey]
    return p ? (p.modules as readonly string[]).includes(module) : false // unknown plan → fail closed
  }
  return false // unknown module → fail closed
}
