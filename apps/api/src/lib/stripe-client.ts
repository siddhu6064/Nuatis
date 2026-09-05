import Stripe from 'stripe'

// The one shared Stripe client constructor for every tenant-customer payment
// call site (payment links, gift cards, invoices, card-on-file). Nuatis's
// own SaaS-billing files (billing.ts, stripe-billing-webhooks.ts,
// voice/call-session-logger.ts) deliberately keep their own separate
// getStripe() — that's a different direction of money flow and must never be
// touched by Connect wiring.
export function getStripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(key)
}

export function getStripeOrNull(): Stripe | null {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) return null
  return new Stripe(key)
}

// Locked-in platform pricing decision: 2% of every connected-account charge.
export const CONNECT_FEE_RATE = 0.02

export function platformFeeAmount(totalAmountCents: number): number {
  return Math.round(totalAmountCents * CONNECT_FEE_RATE)
}
