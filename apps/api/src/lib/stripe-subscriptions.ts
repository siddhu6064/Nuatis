import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

function getStripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) throw new Error('Stripe not configured')
  return new Stripe(key)
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function mapInterval(interval: string): {
  interval: Stripe.PriceCreateParams.Recurring.Interval
  interval_count: number
} {
  switch (interval) {
    case 'weekly':
      return { interval: 'week', interval_count: 1 }
    case 'quarterly':
      return { interval: 'month', interval_count: 3 }
    case 'annually':
      return { interval: 'year', interval_count: 1 }
    default:
      return { interval: 'month', interval_count: 1 } // monthly
  }
}

export async function getOrCreateStripeCustomer(params: {
  tenantId: string
  contactId: string
  email: string
  name: string
}): Promise<string> {
  const supabase = getSupabase()

  // Check if we already have a customer for this contact
  const { data } = await supabase
    .from('client_subscriptions')
    .select('stripe_customer_id')
    .eq('contact_id', params.contactId)
    .eq('tenant_id', params.tenantId)
    .not('stripe_customer_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (data?.stripe_customer_id) {
    return data.stripe_customer_id as string
  }

  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: { tenant_id: params.tenantId, contact_id: params.contactId },
  })

  return customer.id
}

export async function createStripeSubscription(params: {
  tenantId: string
  contactId: string
  customerId: string
  amount: number // in dollars (e.g., 99.99)
  currency: string
  interval: string // our interval ('weekly','monthly','quarterly','annually')
  name: string
  description?: string
}): Promise<{
  subscriptionId: string
  priceId: string
  status: string
  clientSecret: string | null
}> {
  const stripe = getStripe()
  const { interval, interval_count } = mapInterval(params.interval)

  // Create a price
  const price = await stripe.prices.create({
    unit_amount: Math.round(params.amount * 100), // convert to cents
    currency: params.currency || 'usd',
    recurring: { interval, interval_count },
    product_data: { name: params.name },
  })

  // Create subscription
  const subscription = (await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: price.id }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
    metadata: { tenant_id: params.tenantId, contact_id: params.contactId },
  })) as Stripe.Subscription & {
    latest_invoice: (Stripe.Invoice & { payment_intent: Stripe.PaymentIntent | null }) | null
  }

  const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret ?? null

  return {
    subscriptionId: subscription.id,
    priceId: price.id,
    status: subscription.status,
    clientSecret,
  }
}

export async function cancelStripeSubscription(
  subscriptionId: string,
  immediately: boolean
): Promise<void> {
  const stripe = getStripe()
  if (immediately) {
    await stripe.subscriptions.cancel(subscriptionId)
  } else {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  }
}

export async function pauseStripeSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe()
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: 'void' },
  })
}

export async function resumeStripeSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe()
  // Pass empty string to remove pause_collection (Stripe's way to clear it)
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: '' as unknown as Stripe.SubscriptionUpdateParams.PauseCollection,
  })
}
