import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { generateInvoiceNumber } from '../lib/invoice-number.js'

// Stripe v22 removed current_period_start/end from Subscription and moved
// Invoice.subscription into Invoice.parent.subscription_details.subscription.
// We use local interfaces to represent the raw webhook payload shape which
// still carries these fields at runtime (Stripe API continues to send them).
interface StripeSubPayload {
  id: string
  status: string
  current_period_start: number
  current_period_end: number
  cancel_at: number | null
}

interface StripeInvoicePayload {
  id: string
  amount_paid: number
  // Legacy top-level field (still present in many API versions / webhook configs)
  subscription?: string | null
  // v22+ nested location
  parent?: {
    type: string
    subscription_details?: {
      subscription?: string | { id: string }
    } | null
  } | null
}

function resolveInvoiceSubscriptionId(inv: StripeInvoicePayload): string | null {
  // Try legacy top-level field first
  if (inv.subscription && typeof inv.subscription === 'string') return inv.subscription
  // Fall back to v22+ nested location
  const sub = inv.parent?.subscription_details?.subscription
  if (!sub) return null
  return typeof sub === 'string' ? sub : sub.id
}

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

function mapStripeStatus(stripeStatus: string): string {
  const map: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    incomplete: 'incomplete',
    incomplete_expired: 'cancelled',
    trialing: 'active',
    unpaid: 'past_due',
    paused: 'paused',
  }
  return map[stripeStatus] ?? 'active'
}

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Stripe sends the raw body; we must verify the signature before processing.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const stripe = getStripe()
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' })
    return
  }

  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET']
  if (!webhookSecret) {
    res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' })
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
    console.error('[stripe-webhook] signature error:', message)
    res.status(400).json({ error: message })
    return
  }

  const supabase = getSupabase()

  try {
    switch (event.type) {
      case 'customer.subscription.updated': {
        const sub = event.data.object as unknown as StripeSubPayload
        await supabase
          .from('client_subscriptions')
          .update({
            status: mapStripeStatus(sub.status),
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await supabase
          .from('client_subscriptions')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id)
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as unknown as StripeInvoicePayload
        const subscriptionId = resolveInvoiceSubscriptionId(inv)
        if (subscriptionId) {
          await supabase
            .from('client_subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subscriptionId)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as unknown as StripeInvoicePayload
        const subscriptionId = resolveInvoiceSubscriptionId(inv)
        if (!subscriptionId) break

        // Update subscription status to active
        await supabase
          .from('client_subscriptions')
          .update({
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subscriptionId)

        // Auto-create invoice record in our invoices table
        // Look up the client_subscription to get tenant_id and contact_id
        const { data: subscription } = await supabase
          .from('client_subscriptions')
          .select('tenant_id, contact_id, name, amount, currency')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle()

        if (subscription && inv.amount_paid > 0) {
          const invoiceNumber = await generateInvoiceNumber(subscription.tenant_id as string)

          await supabase.from('invoices').insert({
            tenant_id: subscription.tenant_id,
            contact_id: subscription.contact_id,
            invoice_number: invoiceNumber,
            status: 'received',
            issue_date: new Date().toISOString().split('T')[0],
            subtotal: inv.amount_paid / 100,
            tax_rate: 0,
            tax_amount: 0,
            total: inv.amount_paid / 100,
            amount_paid: inv.amount_paid / 100,
            paid_at: new Date().toISOString(),
            notes: `Auto-generated from subscription: ${subscription.name as string}`,
          })
        }
        break
      }

      default:
        // Ignore unhandled event types
        break
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err)
    res.status(500).json({ error: 'Webhook handler error' })
    return
  }

  res.json({ received: true })
})

export default router
