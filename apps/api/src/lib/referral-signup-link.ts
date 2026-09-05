import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Links a new tenant signup to Nuatis's own tenant-affiliate referral
 * program, if a code was passed through at signup. Best-effort — callers
 * should never let this block account creation. The prior lead-capture-only
 * `/api/referrals/signup` endpoint tracked by email alone with no connection
 * to a real account; this resolves that link at the moment the real account
 * is created.
 */
export async function linkReferralSignup(
  supabase: SupabaseClient,
  referralCode: string,
  ownerEmail: string,
  tenantId: string
): Promise<void> {
  try {
    const { data: code } = await supabase
      .from('referral_codes')
      .select('id, tenant_id, status')
      .eq('code', referralCode)
      .maybeSingle()

    if (!code || code.status !== 'active') return

    const { data: existingSignup } = await supabase
      .from('referral_signups')
      .select('id')
      .eq('referral_code_id', code.id)
      .eq('referred_email', ownerEmail)
      .is('referred_tenant_id', null)
      .maybeSingle()

    if (existingSignup) {
      await supabase
        .from('referral_signups')
        .update({ referred_tenant_id: tenantId })
        .eq('id', existingSignup.id)
    } else {
      await supabase.from('referral_signups').insert({
        referral_code_id: code.id,
        referring_tenant_id: code.tenant_id,
        referred_email: ownerEmail,
        referred_tenant_id: tenantId,
        status: 'signed_up',
      })
    }
  } catch (err) {
    console.error('[tenants] referral linking failed:', err)
  }
}
