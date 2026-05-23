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
