import Stripe from 'stripe'
import { getStripe, platformFeeAmount } from './stripe-client.js'
import { getServiceClient } from './supabase.js'
import { getTenantConnectAccount, connectRequestOptions } from './stripe-connect.js'

type SupabaseClient = ReturnType<typeof getServiceClient>

interface ContactRow {
  id: string
  tenant_id: string
  full_name: string | null
  email: string | null
  stripe_customer_id: string | null
  default_payment_method_id: string | null
  stripe_connect_account_id?: string | null
}

interface StripeCustomerRef {
  customerId: string
  connectAccountId: string | null
}

// Reuses/creates the contact's Stripe Customer. A Customer object lives on
// whichever account existed at the moment it was first created — pinned via
// contacts.stripe_connect_account_id rather than re-derived from the
// tenant's CURRENT connect status, so a contact saved before the tenant
// connected Stripe keeps working against the platform account it was
// actually created on. Only a fresh contact (no stripe_customer_id yet)
// picks up the tenant's connect account, if any, at creation time.
export async function getOrCreateStripeCustomerForContact(
  supabase: SupabaseClient,
  contact: ContactRow
): Promise<StripeCustomerRef> {
  if (contact.stripe_customer_id) {
    return {
      customerId: contact.stripe_customer_id,
      connectAccountId: contact.stripe_connect_account_id ?? null,
    }
  }

  const stripe = getStripe()
  const tenantAccount = await getTenantConnectAccount(supabase, contact.tenant_id)
  const customer = await stripe.customers.create(
    {
      email: contact.email ?? undefined,
      name: contact.full_name ?? undefined,
      metadata: { tenantId: contact.tenant_id, contactId: contact.id },
    },
    connectRequestOptions(tenantAccount)
  )

  await supabase
    .from('contacts')
    .update({
      stripe_customer_id: customer.id,
      stripe_connect_account_id: tenantAccount?.accountId ?? null,
    })
    .eq('id', contact.id)
    .eq('tenant_id', contact.tenant_id)

  return { customerId: customer.id, connectAccountId: tenantAccount?.accountId ?? null }
}

export interface SetupIntentResult {
  clientSecret: string
  stripeCustomerId: string
}

// Lets Stripe's own automatic_payment_methods decide what's actually enabled
// on the platform account (card, and us_bank_account/ACH if the account has
// it turned on) — deliberately not hardcoding payment_method_types, so this
// doesn't need updating if ACH gets enabled/disabled on the Stripe account
// later.
export async function createContactSetupIntent(
  supabase: SupabaseClient,
  contact: ContactRow
): Promise<SetupIntentResult> {
  const stripe = getStripe()
  const { customerId, connectAccountId } = await getOrCreateStripeCustomerForContact(
    supabase,
    contact
  )

  const setupIntent = await stripe.setupIntents.create(
    {
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { tenantId: contact.tenant_id, contactId: contact.id },
    },
    connectRequestOptions(connectAccountId)
  )

  if (!setupIntent.client_secret) {
    throw new Error('Stripe did not return a client_secret for the SetupIntent')
  }

  return { clientSecret: setupIntent.client_secret, stripeCustomerId: customerId }
}

// Called from the setup_intent.succeeded webhook — the source of truth for
// "a payment method was actually saved," rather than trusting the frontend to
// report success. Detaches any previous default method so there's no orphaned
// Stripe object left behind (v1 supports exactly one saved method per contact).
export async function attachSetupIntentPaymentMethod(
  supabase: SupabaseClient,
  setupIntent: Stripe.SetupIntent
): Promise<void> {
  const tenantId = setupIntent.metadata?.['tenantId']
  const contactId = setupIntent.metadata?.['contactId']
  const paymentMethodId =
    typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : (setupIntent.payment_method?.id ?? null)

  if (!tenantId || !contactId || !paymentMethodId) return

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, default_payment_method_id, stripe_connect_account_id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!contact) return

  const stripe = getStripe()
  const connectOptions = connectRequestOptions(contact.stripe_connect_account_id as string | null)
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId, {}, connectOptions)
  const type = pm.type
  const last4 = type === 'card' ? (pm.card?.last4 ?? null) : (pm.us_bank_account?.last4 ?? null)

  const previousPmId = contact.default_payment_method_id as string | null
  if (previousPmId && previousPmId !== paymentMethodId) {
    await stripe.paymentMethods.detach(previousPmId, {}, connectOptions).catch(() => {
      /* best-effort cleanup — a stale/already-detached PM id shouldn't block the update */
    })
  }

  await supabase
    .from('contacts')
    .update({
      default_payment_method_id: paymentMethodId,
      default_payment_method_type: type,
      default_payment_method_last4: last4,
    })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
}

export async function removeContactPaymentMethod(
  supabase: SupabaseClient,
  tenantId: string,
  contactId: string
): Promise<void> {
  const { data: contact } = await supabase
    .from('contacts')
    .select('default_payment_method_id, stripe_connect_account_id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const pmId = contact?.default_payment_method_id as string | null | undefined
  if (pmId) {
    const stripe = getStripe()
    const connectOptions = connectRequestOptions(
      contact?.stripe_connect_account_id as string | null
    )
    await stripe.paymentMethods.detach(pmId, {}, connectOptions).catch(() => {
      /* best-effort — already-detached or invalid id shouldn't block clearing our own record */
    })
  }

  await supabase
    .from('contacts')
    .update({
      default_payment_method_id: null,
      default_payment_method_type: null,
      default_payment_method_last4: null,
    })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
}

export type ChargeSavedMethodResult =
  | { charged: true; paymentIntentId: string }
  | { charged: false; reason: 'no_saved_method' | 'stripe_not_configured' | 'charge_failed' }

// Off-session charge against the contact's saved default payment method.
// Deliberately synchronous/confirm:true — Stripe returns success or failure
// immediately in the common case. An off-session charge that needs 3DS
// authentication is treated the same as any other failure here: the caller
// falls back to the existing hosted payment-link flow rather than this
// function trying to email the customer an authentication link itself.
export async function chargeContactSavedMethod(
  supabase: SupabaseClient,
  params: { tenantId: string; contactId: string; amountCents: number; description: string }
): Promise<ChargeSavedMethodResult> {
  const { tenantId, contactId, amountCents, description } = params

  const { data: contact } = await supabase
    .from('contacts')
    .select('stripe_customer_id, default_payment_method_id, stripe_connect_account_id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const stripeCustomerId = contact?.stripe_customer_id as string | null | undefined
  const paymentMethodId = contact?.default_payment_method_id as string | null | undefined
  if (!stripeCustomerId || !paymentMethodId) {
    return { charged: false, reason: 'no_saved_method' }
  }
  const connectAccountId = (contact?.stripe_connect_account_id as string | null) ?? null

  let stripe: Stripe
  try {
    stripe = getStripe()
  } catch {
    return { charged: false, reason: 'stripe_not_configured' }
  }

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description,
        metadata: { tenantId, contactId },
        ...(connectAccountId ? { application_fee_amount: platformFeeAmount(amountCents) } : {}),
      },
      connectRequestOptions(connectAccountId)
    )
    if (intent.status === 'succeeded') {
      return { charged: true, paymentIntentId: intent.id }
    }
    return { charged: false, reason: 'charge_failed' }
  } catch (err) {
    console.warn(
      `[contact-payment-methods] off-session charge failed for contact=${contactId}:`,
      err instanceof Error ? err.message : err
    )
    return { charged: false, reason: 'charge_failed' }
  }
}
