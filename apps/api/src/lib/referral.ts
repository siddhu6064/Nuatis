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
  const businessPrefix = businessName.split(' ')[0].toUpperCase()
  const maxRetries = 10

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const randomSuffix = generateRandomLetters(4)
    const candidate = `${businessPrefix}-${randomSuffix}`

    // Check if code already exists
    const { data } = await supabase
      .from('referral_codes')
      .select('id')
      .eq('code', candidate)
      .maybeSingle()

    if (data === null) {
      // Code is available, insert it
      const { error } = await supabase
        .from('referral_codes')
        .insert({
          tenant_id: tenantId,
          code: candidate,
          status: 'active',
          clicks: 0,
          signups: 0,
          commission_rate: 10.0,
        })
        .select()
        .single()

      if (error) throw error
      return candidate
    }
  }

  throw new Error('Could not generate unique referral code after 10 attempts')
}
