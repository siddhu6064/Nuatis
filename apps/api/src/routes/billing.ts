import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import { PLANS, PLAN_KEYS, type PlanKey } from '../config/stripe-plans.js'

const router = Router()

const isTestEnv = (): boolean => process.env['NODE_ENV'] === 'test'

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Checkout rate limit reached. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTestEnv,
})

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getStripe(): Stripe | null {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) return null
  return new Stripe(key)
}

interface TenantBillingRow {
  id: string
  name: string | null
  billing_email: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  subscription_plan: PlanKey | null
  trial_ends_at: string | null
  current_period_end: string | null
  maya_minutes_used: number | null
  maya_minutes_limit: number | null
  maya_overage_rate: number | null
}

// ── GET /api/billing/plans ────────────────────────────────────────────────────
// Public — pricing page consumes this. No tenant context.
router.get('/plans', (_req: Request, res: Response): void => {
  const plans = PLAN_KEYS.map((key) => {
    const p = PLANS[key]
    return {
      key,
      name: p.name,
      monthly_price_cents: p.monthlyPrice,
      annual_price_cents: p.annualPrice,
      maya_minutes: p.mayaMinutes,
      overage_rate: p.overageRate,
      modules: p.modules,
    }
  })
  res.json({ plans })
})

// ── GET /api/billing/subscription ─────────────────────────────────────────────
// Returns the current tenant's billing snapshot.
router.get('/subscription', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('tenants')
    .select(
      'subscription_plan, subscription_status, trial_ends_at, current_period_end, maya_minutes_used, maya_minutes_limit, maya_overage_rate'
    )
    .eq('id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({
    plan: data.subscription_plan ?? null,
    status: data.subscription_status ?? 'trialing',
    trial_ends_at: data.trial_ends_at ?? null,
    current_period_end: data.current_period_end ?? null,
    maya_minutes_used: data.maya_minutes_used ?? 0,
    maya_minutes_limit: data.maya_minutes_limit ?? null,
    maya_overage_rate: data.maya_overage_rate ?? null,
  })
})

// ── POST /api/billing/checkout ────────────────────────────────────────────────
// Body: { plan: 'core'|'pro'|'scale', interval: 'month'|'year' }
router.post(
  '/checkout',
  requireAuth,
  requireRole('owner', 'admin'),
  checkoutLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const stripe = getStripe()
    if (!stripe) {
      res.status(503).json({ error: 'Stripe not configured' })
      return
    }

    const body = req.body as { plan?: string; interval?: string }
    const planKey = body.plan as PlanKey | undefined
    const interval = body.interval

    if (!planKey || !PLAN_KEYS.includes(planKey)) {
      res.status(400).json({ error: 'plan must be one of: core, pro, scale' })
      return
    }
    if (interval !== 'month' && interval !== 'year') {
      res.status(400).json({ error: 'interval must be month or year' })
      return
    }

    const plan = PLANS[planKey]
    const priceId = interval === 'year' ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly
    if (!priceId) {
      res.status(503).json({ error: `Stripe price ID not configured for ${planKey}/${interval}` })
      return
    }

    const supabase = getSupabase()
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, billing_email, stripe_customer_id')
      .eq('id', authed.tenantId)
      .single<Pick<TenantBillingRow, 'id' | 'name' | 'billing_email' | 'stripe_customer_id'>>()

    if (tenantErr || !tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }

    // Resolve customer email: prefer billing_email, fall back to the user's
    // auth email (looked up via Supabase auth admin).
    let customerEmail = tenant.billing_email ?? ''
    if (!customerEmail && authed.userId) {
      try {
        const { data: userRes } = await supabase.auth.admin.getUserById(authed.userId)
        customerEmail = userRes?.user?.email ?? ''
      } catch {
        // ignore — email is best-effort
      }
    }

    try {
      let customerId = tenant.stripe_customer_id ?? ''
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: customerEmail || undefined,
          name: tenant.name ?? undefined,
          metadata: { tenant_id: tenant.id },
        })
        customerId = customer.id

        await supabase
          .from('tenants')
          .update({ stripe_customer_id: customerId })
          .eq('id', tenant.id)
      }

      // Stripe v22 split the LineItem type across multiple namespaces and
      // the SDK now requires it inline. Use a plain object — Stripe accepts
      // it at runtime and the call signature below enforces the shape.
      const lineItems: Array<{ price: string; quantity?: number }> = [
        { price: priceId, quantity: 1 },
      ]
      // Metered overage item — no quantity on metered items, but the line
      // must still be present so the subscription_item exists for usage
      // reports.
      if (plan.stripeOveragePriceId) {
        lineItems.push({ price: plan.stripeOveragePriceId })
      }

      const webUrl = process.env['WEB_URL'] ?? 'https://app.nuatis.com'
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: lineItems,
        subscription_data: {
          trial_period_days: 7,
          metadata: { tenant_id: tenant.id, plan: planKey },
        },
        success_url: `${webUrl}/dashboard?subscribed=true`,
        cancel_url: `${webUrl}/pricing`,
        allow_promotion_codes: true,
        metadata: { tenant_id: tenant.id, plan: planKey },
      })

      res.json({ url: session.url })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      console.error('[billing] checkout error:', message)
      res.status(502).json({ error: message })
    }
  }
)

// ── POST /api/billing/portal ──────────────────────────────────────────────────
// Returns a Stripe Customer Portal URL for the tenant.
router.post(
  '/portal',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const stripe = getStripe()
    if (!stripe) {
      res.status(503).json({ error: 'Stripe not configured' })
      return
    }

    const supabase = getSupabase()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_customer_id')
      .eq('id', authed.tenantId)
      .single<{ stripe_customer_id: string | null }>()

    if (!tenant?.stripe_customer_id) {
      res.status(400).json({ error: 'No Stripe customer found for this tenant' })
      return
    }

    try {
      const webUrl = process.env['WEB_URL'] ?? 'https://app.nuatis.com'
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: `${webUrl}/settings/billing`,
      })

      res.json({ url: portalSession.url })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      console.error('[billing] portal error:', message)
      res.status(502).json({ error: message })
    }
  }
)

export default router
