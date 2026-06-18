import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

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
  const supabase = getSupabase()
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
