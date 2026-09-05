import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from './stripe-client.js'

export interface TenantConnectAccount {
  accountId: string
}

// Returns the tenant's connected account only when it's actually usable for
// new charges — 'pending' (onboarding unfinished) or 'restricted' means every
// call site should fall back to the shared platform account, exactly like a
// tenant who never connected at all.
export async function getTenantConnectAccount(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantConnectAccount | null> {
  const { data } = await supabase
    .from('tenants')
    .select('stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled')
    .eq('id', tenantId)
    .maybeSingle()

  if (
    !data?.['stripe_connect_account_id'] ||
    data['stripe_connect_status'] !== 'active' ||
    !data['stripe_connect_charges_enabled']
  ) {
    return null
  }

  return { accountId: data['stripe_connect_account_id'] as string }
}

// Stripe's per-call RequestOptions — pass as the final argument to any
// stripe.<resource>.<method>() call. `undefined` when the tenant hasn't
// connected (or the account id is a raw string already pinned on a row, e.g.
// contacts.stripe_connect_account_id), so the call falls through to the
// shared platform account exactly as it did before Connect existed.
export function connectRequestOptions(
  accountId: string | TenantConnectAccount | null | undefined
): { stripeAccount: string } | undefined {
  if (!accountId) return undefined
  const id = typeof accountId === 'string' ? accountId : accountId.accountId
  return { stripeAccount: id }
}

export async function createConnectAccount(email: string, tenantId: string): Promise<string> {
  const stripe = getStripe()
  const account = await stripe.accounts.create({
    type: 'standard',
    email: email || undefined,
    metadata: { tenantId },
  })
  return account.id
}

export async function createOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe()
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  })
  return link.url
}

// Standard accounts get their own full Stripe dashboard — this is a one-time
// login link into it, not a Nuatis-hosted view.
export async function createDashboardLoginLink(accountId: string): Promise<string> {
  const stripe = getStripe()
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

// Live status check — called from the public /return redirect and from the
// account.updated Connect webhook. charges_enabled/payouts_enabled are the
// two flags Stripe actually uses to mean "this account can move money";
// details_submitted alone isn't enough (an account can submit details and
// still be sitting in Stripe's own verification queue).
export async function refreshConnectAccountStatus(
  supabase: SupabaseClient,
  tenantId: string,
  accountId: string
): Promise<{ status: string; chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const stripe = getStripe()
  const account = await stripe.accounts.retrieve(accountId)

  const status = account.charges_enabled
    ? 'active'
    : account.requirements?.disabled_reason
      ? 'restricted'
      : 'pending'

  await supabase
    .from('tenants')
    .update({
      stripe_connect_status: status,
      stripe_connect_charges_enabled: account.charges_enabled ?? false,
      stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
    })
    .eq('id', tenantId)
    .eq('stripe_connect_account_id', accountId)

  if (status === 'active') {
    // Stamp only the first time — a later temporary restriction and
    // re-activation shouldn't reset "when this tenant first onboarded."
    await supabase
      .from('tenants')
      .update({ stripe_connect_onboarded_at: new Date().toISOString() })
      .eq('id', tenantId)
      .is('stripe_connect_onboarded_at', null)
  }

  return {
    status,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  }
}
