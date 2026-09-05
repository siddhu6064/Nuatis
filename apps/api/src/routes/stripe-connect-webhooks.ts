import { Router, type Request, type Response } from 'express'
import Stripe from 'stripe'
import { getServiceClient } from '../lib/supabase.js'
import { attachSetupIntentPaymentMethod } from '../lib/contact-payment-methods.js'
import { refreshConnectAccountStatus } from '../lib/stripe-connect.js'
import { handleCheckoutSessionPaid, handleCheckoutSessionAsyncFailed } from './stripe-webhooks.js'

const router = Router()

// ── POST /api/webhooks/stripe-connect ────────────────────────────────────────
// A SEPARATE webhook endpoint from /api/webhooks/stripe — that one only ever
// received platform-account events. Once a tenant connects a Standard
// account, checkout sessions/setup intents created directly on their account
// (via the stripeAccount request option) fire as Connect events — visible
// only to a webhook endpoint configured in the Stripe Dashboard to listen to
// "events on connected accounts," with its own signing secret
// (STRIPE_CONNECT_WEBHOOK_SECRET, separate from STRIPE_WEBHOOK_SECRET).
// Tenants who haven't connected keep firing on the existing platform
// endpoint, completely unaffected by this one.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) {
    res.status(503).json({ error: 'Stripe not configured' })
    return
  }
  const stripe = new Stripe(key)

  const webhookSecret = process.env['STRIPE_CONNECT_WEBHOOK_SECRET']
  if (!webhookSecret) {
    res.status(503).json({ error: 'STRIPE_CONNECT_WEBHOOK_SECRET not configured' })
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
    console.error('[stripe-connect-webhook] signature error:', message)
    res.status(400).json({ error: message })
    return
  }

  const supabase = getServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.payment_status === 'paid') {
          await handleCheckoutSessionPaid(supabase, session)
        }
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

      case 'account.updated': {
        const connectedAccountId = event.account
        if (connectedAccountId) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('id')
            .eq('stripe_connect_account_id', connectedAccountId)
            .maybeSingle()
          if (tenant) {
            await refreshConnectAccountStatus(supabase, tenant.id as string, connectedAccountId)
          }
        }
        break
      }

      default:
        break
    }
  } catch (err) {
    console.error(`[stripe-connect-webhook] handler error for ${event.type}:`, err)
    res.status(500).json({ error: 'Webhook handler error' })
    return
  }

  res.json({ received: true })
})

export default router
