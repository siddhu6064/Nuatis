/**
 * Stripe SaaS billing webhook handler — Phase 9.
 *
 * Distinct from the existing /api/webhooks/stripe handler (which manages
 * the tenants' own customer subscriptions in `client_subscriptions`).
 * This handler is for *Nuatis-as-vendor* billing: events about the
 * tenant's subscription TO Nuatis, applied to the `tenants` table.
 *
 * Mount: /api/webhooks/stripe-billing with express.raw() BEFORE json().
 */
import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { logAuditEvent } from '../middleware/audit-logger.js'
import { sendEmail } from '../lib/email-client.js'
import { PLANS, planKeyFromPriceId, modulesForPlan, type PlanKey } from '../config/stripe-plans.js'
import { invalidateTrialCache } from '../lib/trial-cache.js'

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

// Stripe v22 keeps period + trial fields at the Subscription root in the
// webhook payload even though they were moved off the typed Subscription
// interface. We re-narrow with a local interface to access them safely.
export interface StripeSubPayload {
  id: string
  status: string
  customer: string | { id: string }
  current_period_end: number | null
  trial_end: number | null
  items: {
    data: Array<{
      id: string
      price: { id: string; recurring?: { usage_type?: string } | null }
    }>
  }
  metadata?: Record<string, string>
}

export interface StripeInvoicePayload {
  id: string
  customer: string | { id: string } | null
  subscription?: string | null
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string }
    } | null
  } | null
  period_end?: number | null
}

export function resolveInvoiceSubscriptionId(inv: StripeInvoicePayload): string | null {
  if (inv.subscription && typeof inv.subscription === 'string') return inv.subscription
  const sub = inv.parent?.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

export function customerIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

export function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * The subscription_status enum carries legacy labels ('cancelled',
 * 'incomplete') that must never be written, and Stripe emits statuses the
 * enum lacks ('incomplete_expired' — writing it raw throws). Every Stripe
 * status passes this allow-list map before a write; unknown statuses
 * degrade to 'past_due'.
 *
 * Deviations from the approved spec, kept because both fail closed under
 * requirePlan: incomplete → 'past_due' (spec said 'unpaid'), and
 * cancelled → 'canceled' added defensively for the two-L spelling.
 */
const STRIPE_STATUS_MAP: Record<string, string> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'unpaid',
  paused: 'paused',
  canceled: 'canceled',
  cancelled: 'canceled',
  incomplete: 'past_due',
  incomplete_expired: 'canceled',
}

export function mapStripeStatus(status: string): string {
  return STRIPE_STATUS_MAP[status] ?? 'past_due'
}

/**
 * Identify the plan + the metered overage subscription_item from a
 * subscription payload. Stripe stores the line items under `items.data`;
 * the metered one has `recurring.usage_type === 'metered'`.
 */
export function identifyPlanAndOverageItem(sub: StripeSubPayload): {
  planKey: PlanKey | null
  overageItemId: string | null
} {
  let planKey: PlanKey | null = null
  let overageItemId: string | null = null
  for (const item of sub.items.data) {
    const usageType = item.price.recurring?.usage_type
    if (usageType === 'metered') {
      overageItemId = item.id
    }
    const candidate = planKeyFromPriceId(item.price.id)
    if (candidate && !planKey) planKey = candidate
  }
  return { planKey, overageItemId }
}

// ── POST /api/webhooks/stripe-billing ─────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe()
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' })
    return
  }

  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET']
  if (!webhookSecret) {
    // Fail closed — never accept unverified events.
    console.error('[stripe-billing-webhook] STRIPE_WEBHOOK_SECRET not set')
    res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' })
    return
  }

  const sig = req.headers['stripe-signature']
  if (!sig) {
    res.status(400).json({ error: 'Missing stripe-signature header' })
    return
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed'
    console.error('[stripe-billing-webhook] signature error:', message)
    res.status(400).json({ error: message })
    return
  }

  const supabase = getSupabase()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
        const customerId = customerIdOf(session.customer as string | { id: string } | null)
        const tenantId = session.metadata?.['tenant_id'] ?? null

        if (!subscriptionId || !customerId) {
          console.warn('[stripe-billing-webhook] checkout.session.completed missing IDs')
          break
        }

        const sub = (await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price'],
        })) as unknown as StripeSubPayload

        const { planKey, overageItemId } = identifyPlanAndOverageItem(sub)
        if (!planKey) {
          console.warn(
            `[stripe-billing-webhook] checkout.session.completed: no matching plan for sub=${subscriptionId}`
          )
          break
        }
        const plan = PLANS[planKey]

        const status = mapStripeStatus(sub.status)

        const update: Record<string, unknown> = {
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          subscription_status: status,
          subscription_plan: planKey,
          trial_ends_at: unixToIso(sub.trial_end),
          current_period_end: unixToIso(sub.current_period_end),
          maya_minutes_limit: plan.mayaMinutes,
          maya_overage_rate: plan.overageRate,
          stripe_overage_item_id: overageItemId,
          modules: modulesForPlan(planKey),
          maya_minutes_used: 0,
        }

        // Prefer tenant_id from session metadata; fall back to customer mapping.
        let query = supabase.from('tenants').update(update)
        query = tenantId ? query.eq('id', tenantId) : query.eq('stripe_customer_id', customerId)
        const { error } = await query
        if (error) {
          console.error('[stripe-billing-webhook] tenant update error:', error.message)
        }

        const resolvedTenantId =
          tenantId ??
          (
            await supabase
              .from('tenants')
              .select('id')
              .eq('stripe_customer_id', customerId)
              .maybeSingle<{ id: string }>()
          ).data?.id ??
          null

        if (resolvedTenantId) {
          // Tenant just paid — drop the cached trial flag so the read-only
          // gate lifts immediately instead of waiting out the 60s TTL.
          invalidateTrialCache(resolvedTenantId)
          await logAuditEvent({
            tenantId: resolvedTenantId,
            action: 'subscription.created',
            resourceType: 'subscription',
            resourceId: sub.id,
            details: { plan: planKey, status },
          })
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as unknown as StripeSubPayload
        const customerId = customerIdOf(sub.customer)
        if (!customerId) break

        const { planKey, overageItemId } = identifyPlanAndOverageItem(sub)
        if (!planKey) {
          console.warn(
            `[stripe-billing-webhook] subscription.updated: no matching plan for sub=${sub.id}`
          )
          break
        }
        const plan = PLANS[planKey]
        const status = mapStripeStatus(sub.status)

        const { error } = await supabase
          .from('tenants')
          .update({
            subscription_status: status,
            subscription_plan: planKey,
            current_period_end: unixToIso(sub.current_period_end),
            maya_minutes_limit: plan.mayaMinutes,
            maya_overage_rate: plan.overageRate,
            stripe_overage_item_id: overageItemId,
            modules: modulesForPlan(planKey),
          })
          .eq('stripe_customer_id', customerId)
        if (error) {
          console.error('[stripe-billing-webhook] subscription.updated error:', error.message)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as StripeSubPayload
        const customerId = customerIdOf(sub.customer)
        if (!customerId) break

        // Grace period: keep `maya` module enabled so in-flight calls
        // aren't cut off. Other modules go to false.
        const graceModules: Record<string, boolean> = { maya: true }
        for (const m of [
          'crm',
          'scheduling',
          'appointments',
          'pipeline',
          'automation',
          'insights',
          'campaigns',
          'cpq',
        ]) {
          graceModules[m] = false
        }

        const { data: tenant } = await supabase
          .from('tenants')
          .select('id, billing_email, name')
          .eq('stripe_customer_id', customerId)
          .maybeSingle<{ id: string; billing_email: string | null; name: string | null }>()

        await supabase
          .from('tenants')
          .update({
            subscription_status: 'canceled',
            subscription_plan: null,
            modules: graceModules,
          })
          .eq('stripe_customer_id', customerId)

        if (tenant?.billing_email) {
          void sendEmail({
            to: tenant.billing_email,
            subject: 'Your Nuatis subscription has been canceled',
            html: `<p>Hi,</p><p>Your Nuatis subscription has been canceled. Maya call handling will remain active for 7 days so any in-flight calls don't get cut off.</p><p>If this was a mistake, you can re-subscribe at any time: <a href="${process.env['WEB_URL'] ?? 'https://app.nuatis.com'}/pricing">View plans</a></p><p>— Nuatis</p>`,
            tenantId: tenant.id,
          })
        }

        if (tenant?.id) {
          await logAuditEvent({
            tenantId: tenant.id,
            action: 'subscription.canceled',
            resourceType: 'subscription',
            resourceId: sub.id,
          })
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as unknown as StripeInvoicePayload
        const customerId = customerIdOf(inv.customer)
        const subscriptionId = resolveInvoiceSubscriptionId(inv)
        if (!customerId) break

        await supabase
          .from('tenants')
          .update({
            subscription_status: 'active',
            // Reset Maya usage at the start of each new billing period.
            maya_minutes_used: 0,
            current_period_end: unixToIso(inv.period_end),
          })
          .eq('stripe_customer_id', customerId)

        if (subscriptionId) {
          // No-op: subscriptionId is unused below but referenced so the linter
          // doesn't flag the local. (Kept for parity with the other handlers.)
          void subscriptionId
        }
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as unknown as StripeInvoicePayload
        const customerId = customerIdOf(inv.customer)
        if (!customerId) break

        const { data: tenant } = await supabase
          .from('tenants')
          .select('id, billing_email')
          .eq('stripe_customer_id', customerId)
          .maybeSingle<{ id: string; billing_email: string | null }>()

        await supabase
          .from('tenants')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', customerId)

        if (tenant?.billing_email) {
          void sendEmail({
            to: tenant.billing_email,
            subject: 'Action required — Nuatis payment failed',
            html: `<p>Hi,</p><p>We weren't able to charge your card for the latest Nuatis invoice. Your account is now in a past-due state. Service will continue for 7 days while you update your payment details.</p><p><a href="${process.env['WEB_URL'] ?? 'https://app.nuatis.com'}/settings/billing">Update payment details</a></p><p>— Nuatis</p>`,
            tenantId: tenant.id,
          })
        }
        break
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as unknown as StripeSubPayload
        const customerId = customerIdOf(sub.customer)
        if (!customerId) break

        const { data: tenant } = await supabase
          .from('tenants')
          .select('id, billing_email, name')
          .eq('stripe_customer_id', customerId)
          .maybeSingle<{ id: string; billing_email: string | null; name: string | null }>()

        if (tenant?.billing_email) {
          void sendEmail({
            to: tenant.billing_email,
            subject: 'Your Nuatis trial ends in 3 days',
            html: `<p>Hi,</p><p>Just a heads-up — your 7-day free trial of Nuatis ends in 3 days. To keep Maya answering your calls without interruption, no action is needed and your card will be charged automatically.</p><p>Want to change plans first? <a href="${process.env['WEB_URL'] ?? 'https://app.nuatis.com'}/pricing">View plans</a></p><p>— Nuatis</p>`,
            tenantId: tenant.id,
          })
        }
        break
      }

      default:
        // Ignore unhandled event types
        break
    }
  } catch (err) {
    console.error(`[stripe-billing-webhook] handler error for ${event.type}:`, err)
    res.status(500).json({ error: 'Webhook handler error' })
    return
  }

  res.json({ received: true })
})

export default router
