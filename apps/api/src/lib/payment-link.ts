import { getServiceClient } from './supabase.js'
import { createSquareCheckoutLink } from './square-client.js'
import { getStripe } from './stripe-client.js'
import {
  getTenantConnectAccount,
  connectRequestOptions,
  type TenantConnectAccount,
} from './stripe-connect.js'

export { getStripe }

export interface CreatePaymentLinkParams {
  tenantId: string
  amount: number
  description: string
  contactId?: string | null
  label?: string | null
  currency?: string
  tipAmount?: number | null
}

export interface CreatedPaymentLink {
  id: string
  url: string
  amount: number
  description: string
  processor: string
}

// Shared by the staff-facing POST /api/payment-links route and Maya's
// place_order voice tool — one payment link + payment_links row, regardless
// of who's collecting the payment. Stripe is the default processor; when
// STRIPE_SECRET_KEY isn't configured, falls back to Square (if the tenant
// has connected it) rather than failing the whole flow.
export async function createPaymentLink(
  params: CreatePaymentLinkParams
): Promise<CreatedPaymentLink> {
  const { tenantId, amount, description, contactId = null, label = null } = params
  const currency = params.currency ?? 'usd'
  const tipAmount = params.tipAmount ?? null
  const totalAmount = amount + (tipAmount ?? 0)
  const supabase = getServiceClient()

  let processor: 'stripe' | 'square'
  let linkId: string
  let url: string
  let connectAccount: TenantConnectAccount | null = null

  try {
    const stripe = getStripe()
    connectAccount = await getTenantConnectAccount(supabase, tenantId)
    const connectOptions = connectRequestOptions(connectAccount)
    const amountCents = Math.round(totalAmount * 100)

    const price = await stripe.prices.create(
      {
        currency,
        unit_amount: amountCents,
        product_data: { name: description },
      },
      connectOptions
    )
    // Stripe's Payment Links API has no application_fee_amount param (unlike
    // Checkout Sessions/PaymentIntents) — a connected tenant's link routes
    // 100% of the payment to their own account with no Nuatis platform fee.
    // The 2% fee applies wherever a PaymentIntent is created directly
    // (chargeContactSavedMethod in contact-payment-methods.ts); moving these
    // Payment Link flows onto Checkout Sessions to charge a fee here too is
    // a real, separate follow-up, not attempted in this pass.
    const link = await stripe.paymentLinks.create(
      {
        line_items: [{ price: price.id, quantity: 1 }],
        after_completion: {
          type: 'hosted_confirmation',
          hosted_confirmation: { custom_message: 'Thank you for your payment!' },
        },
        metadata: {
          tenantId,
          contactId: contactId ?? '',
          label: label ?? '',
        },
      },
      connectOptions
    )
    processor = 'stripe'
    linkId = link.id
    url = link.url
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (!message.includes('STRIPE_SECRET_KEY')) throw err

    const squareLink = await createSquareCheckoutLink({
      tenantId,
      amountCents: Math.round(totalAmount * 100),
      currency: currency.toUpperCase(),
      name: description,
    })
    processor = 'square'
    linkId = squareLink.id
    url = squareLink.url
  }

  const { data: record, error } = await supabase
    .from('payment_links')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      stripe_link_id: processor === 'stripe' ? linkId : null,
      square_payment_link_id: processor === 'square' ? linkId : null,
      stripe_connect_account_id:
        processor === 'stripe' ? (connectAccount?.accountId ?? null) : null,
      processor,
      url,
      amount: Number(totalAmount.toFixed(2)),
      tip_amount: tipAmount !== null ? Number(tipAmount.toFixed(2)) : null,
      description,
      label,
    })
    .select('*')
    .single()

  if (error || !record) {
    throw new Error(error?.message ?? 'Failed to save payment link')
  }

  return {
    id: record.id as string,
    url: record.url as string,
    amount: record.amount as number,
    description: record.description as string,
    processor: record.processor as string,
  }
}
