import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import { PLANS, PLAN_KEYS, type PlanKey } from '../config/stripe-plans.js'
import { checkoutLimiter } from '../middleware/rate-limit.js'

const router = Router()

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

// ── GET /api/billing/invoices ─────────────────────────────────────────────────
// The tenant's own Nuatis subscription invoice history — previously the only
// way to see even one past invoice was leaving the app for the Stripe portal.
router.get('/invoices', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', authed.tenantId)
    .single<{ stripe_customer_id: string | null }>()

  if (!tenant?.stripe_customer_id) {
    res.json({ invoices: [] })
    return
  }

  const stripe = getStripe()
  if (!stripe) {
    res.status(503).json({ error: 'Billing is not configured' })
    return
  }

  try {
    const list = await stripe.invoices.list({ customer: tenant.stripe_customer_id, limit: 24 })
    res.json({
      invoices: list.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount_paid_cents: inv.amount_paid,
        currency: inv.currency,
        created: inv.created,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      })),
    })
  } catch (err) {
    console.error('[billing] invoices.list failed:', err)
    res.status(500).json({ error: 'Failed to load invoice history' })
  }
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

// ── POST /api/billing/change-plan ─────────────────────────────────────────────
// Body: { plan: 'core'|'pro'|'scale', interval: 'month'|'year' }
// Swaps the price on the tenant's EXISTING Stripe subscription (unlike
// /checkout, which always starts a brand-new one) — self-serve upgrade or
// downgrade. Stripe prorates by default; tenants.subscription_plan/modules
// are NOT written here — customer.subscription.updated (stripe-billing-
// webhooks.ts) is the single source of truth and re-derives both from
// whatever price/items the subscription ends up with.
router.post(
  '/change-plan',
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
    const newBasePriceId =
      interval === 'year' ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly
    if (!newBasePriceId) {
      res.status(503).json({ error: `Stripe price ID not configured for ${planKey}/${interval}` })
      return
    }

    const supabase = getSupabase()
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, subscription_plan, stripe_subscription_id')
      .eq('id', authed.tenantId)
      .single<
        Pick<TenantBillingRow, 'id' | 'subscription_plan' | 'stripe_subscription_id'> & {
          stripe_subscription_id: string | null
        }
      >()

    if (tenantErr || !tenant) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }
    if (!tenant.stripe_subscription_id) {
      res.status(400).json({
        error: 'No active subscription to change — use checkout to start one',
      })
      return
    }
    if (tenant.subscription_plan === planKey) {
      res.status(400).json({ error: `Already on the ${plan.name} plan` })
      return
    }

    try {
      const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id)
      const baseItem = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')
      const overageItem = sub.items.data.find((i) => i.price.recurring?.usage_type === 'metered')

      const items: Stripe.SubscriptionUpdateParams.Item[] = []
      items.push(baseItem ? { id: baseItem.id, price: newBasePriceId } : { price: newBasePriceId })
      if (plan.stripeOveragePriceId) {
        items.push(
          overageItem
            ? { id: overageItem.id, price: plan.stripeOveragePriceId }
            : { price: plan.stripeOveragePriceId }
        )
      } else if (overageItem) {
        items.push({ id: overageItem.id, deleted: true })
      }

      await stripe.subscriptions.update(tenant.stripe_subscription_id, {
        items,
        proration_behavior: 'create_prorations',
      })

      res.json({ success: true, plan: planKey })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe error'
      console.error('[billing] change-plan error:', message)
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
