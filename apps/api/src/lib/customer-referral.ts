import { getServiceClient } from './supabase.js'

function generateRandomAlphanumeric(count: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < count; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Lazily creates (or returns the existing) referral code for a contact.
// One code per (tenant, contact) — enforced by the unique index, not by
// this function, so a race between two requests just retries on 23505.
export async function generateCustomerReferralCode(
  tenantId: string,
  contactId: string,
  firstName: string
): Promise<string> {
  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('contact_referral_codes')
    .select('code')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.code as string

  const prefix = (firstName.trim() || 'FRIEND').toUpperCase().replace(/[^A-Z]/g, '') || 'FRIEND'
  const maxRetries = 10

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const candidate = `${prefix}${generateRandomAlphanumeric(4)}`

    const { error } = await supabase.from('contact_referral_codes').insert({
      tenant_id: tenantId,
      contact_id: contactId,
      code: candidate,
      status: 'active',
      clicks: 0,
    })

    if (!error) return candidate
    // 23505 = unique_violation — either the code was taken, or a concurrent
    // request already created this contact's row; check the latter before retrying.
    if ((error as { code?: string }).code === '23505') {
      const { data: raceWinner } = await supabase
        .from('contact_referral_codes')
        .select('code')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .maybeSingle()
      if (raceWinner) return raceWinner.code as string
      continue
    }
    throw error
  }

  throw new Error('Could not generate unique customer referral code after 10 attempts')
}
