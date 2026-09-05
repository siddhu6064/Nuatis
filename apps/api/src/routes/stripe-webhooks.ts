import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from '../lib/supabase.js'
import { generateInvoiceNumber } from '../lib/invoice-number.js'
import { applyInvoicePayment } from '../lib/invoice-payment.js'
import { attachSetupIntentPaymentMethod } from '../lib/contact-payment-methods.js'
import { notifyOwner } from '../lib/notifications.js'

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

// Shared by checkout.session.completed (card — synchronous) and
// checkout.session.async_payment_succeeded (ACH — fires once the debit
// actually clears, days later). Both mean the same thing: the money landed.
export async function handleCheckoutSessionPaid(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.metadata?.['kind'] === 'invoice_payment') {
    const invoiceId = session.metadata['invoiceId']
    const tenantId = session.metadata['tenantId']
    const amountPaid = (session.amount_total ?? 0) / 100
    if (invoiceId && tenantId && amountPaid > 0) {
      // applyInvoicePayment's allowed-status gate doubles as the replay
      // guard here: an already-'received' invoice (e.g. Stripe redelivering
      // this event) hits invalid_status and no-ops.
      const result = await applyInvoicePayment(supabase, invoiceId, tenantId, amountPaid)
      if (result.kind === 'not_found') {
        console.error(`[stripe-webhook] invoice payment: invoice not found ${invoiceId}`)
      }
    }
  } else if (session.metadata?.['kind'] === 'gift_card_purchase') {
    const giftCardId = session.metadata['giftCardId']
    const tenantId = session.metadata['tenantId']
    if (giftCardId && tenantId) {
      // Only flips pending_payment → active — a redelivered event finds the
      // card already 'active' and this is a no-op (replay guard).
      await supabase
        .from('gift_cards')
        .update({ status: 'active' })
        .eq('id', giftCardId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending_payment')
    }
  }
}

function getStripe(): Stripe | null {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) return null
  return new Stripe(key)
}

// Shared by both webhook endpoints' checkout.session.async_payment_failed
// case — the platform-account handler below and the Connect-account handler
// in stripe-connect-webhooks.ts (a connected tenant's async payment methods
// can fail exactly the same way a platform-account one can).
export async function handleCheckoutSessionAsyncFailed(
  supabase: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.metadata?.['kind'] === 'gift_card_purchase') {
    const giftCardId = session.metadata['giftCardId']
    const tenantId = session.metadata['tenantId']
    if (giftCardId && tenantId) {
      // Never became real money — revert out of pending_payment so the
      // card doesn't sit forever looking like a purchase in progress.
      // Guarded on the current status so a redelivered event, or one
      // that lands after the card was somehow already activated, no-ops.
      const { data: reverted } = await supabase
        .from('gift_cards')
        .update({ status: 'cancelled' })
        .eq('id', giftCardId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending_payment')
        .select('id')
        .maybeSingle()
      if (reverted) {
        void notifyOwner(tenantId, 'payment_failed', {
          pushTitle: 'Gift card payment failed',
          pushBody: 'A customer’s bank payment for a gift card purchase did not clear.',
          pushUrl: '/settings/gift-cards',
        })
      }
    }
  } else if (session.metadata?.['kind'] === 'invoice_payment') {
    const invoiceId = session.metadata['invoiceId']
    const tenantId = session.metadata['tenantId']
    if (invoiceId && tenantId) {
      // Nothing to revert — applyInvoicePayment only ever ran on the
      // paid path, so the invoice was never marked received. Just
      // surface it, since the customer likely believes they paid.
      void notifyOwner(tenantId, 'payment_failed', {
        pushTitle: 'Invoice payment failed',
        pushBody: 'A customer’s bank payment for an invoice did not clear.',
        pushUrl: `/invoices/${invoiceId}`,
      })
    }
  }
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

  const supabase = getServiceClient()

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
          // DUP-01: skip if this Stripe invoice was already recorded (a replay
          // inside Stripe's timestamp tolerance window would otherwise duplicate).
          const { data: existingInvoice } = await supabase
            .from('invoices')
            .select('id')
            .eq('stripe_invoice_id', inv.id)
            .maybeSingle()

          if (existingInvoice) {
            console.info(`[stripe-webhook] invoice already processed: ${inv.id}`)
          } else {
            const invoiceNumber = await generateInvoiceNumber(subscription.tenant_id as string)

            await supabase.from('invoices').insert({
              tenant_id: subscription.tenant_id,
              contact_id: subscription.contact_id,
              invoice_number: invoiceNumber,
              stripe_invoice_id: inv.id,
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
        }
        break
      }

      // checkout.session.completed fires the instant the payer submits —
      // for a card that means paid, but for ACH direct debit the session
      // completes with payment_status:'unpaid' while the bank debit is
      // still processing (it can take days to actually clear or fail).
      // Neither Payment Links call here (payment-link.ts, gift-cards.ts,
      // gift-cards-public.ts, invoices.ts) restricts payment_method_types,
      // so Stripe's dashboard-level "automatic payment methods" setting
      // already offers ACH once enabled there — this handler is the part
      // that must not treat "completed" as "paid" for that case.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.payment_status === 'paid') {
          await handleCheckoutSessionPaid(supabase, session)
        }
        // payment_status 'unpaid' here means an async method (ACH) is still
        // processing — wait for async_payment_succeeded/failed below rather
        // than acting now.
        break
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutSessionPaid(supabase, session)
        break
      }

      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutSessionAsyncFailed(supabase, session)
        break
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object as Stripe.SetupIntent
        await attachSetupIntentPaymentMethod(supabase, setupIntent)
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
