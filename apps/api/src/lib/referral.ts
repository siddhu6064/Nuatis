import { getServiceClient } from './supabase.js'

function generateRandomLetters(count: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let result = ''
  for (let i = 0; i < count; i++) {
    result += letters.charAt(Math.floor(Math.random() * letters.length))
  }
  return result
}

export async function generateReferralCode(
  tenantId: string,
  businessName: string
): Promise<string> {
  const supabase = getServiceClient()
  const businessPrefix = (businessName.split(' ')[0] ?? 'REF').toUpperCase()
  const maxRetries = 10

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const randomSuffix = generateRandomLetters(4)
    const candidate = `${businessPrefix}-${randomSuffix}`

    const { error } = await supabase.from('referral_codes').insert({
      tenant_id: tenantId,
      code: candidate,
      status: 'active',
      clicks: 0,
      signups: 0,
      commission_rate: 20.0,
    })

    if (!error) return candidate
    // 23505 = unique_violation — code already taken, retry
    if ((error as { code?: string }).code === '23505') continue
    throw error
  }

  throw new Error('Could not generate unique referral code after 10 attempts')
}
