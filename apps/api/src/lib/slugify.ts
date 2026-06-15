import { nanoid } from 'nanoid'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// Public trigger-link token: full-alphabet nanoid(16). Never lowercased —
// case-folding nanoid's 64-char alphabet would halve the per-char entropy
// and make tokens enumerable.
export async function generateTriggerToken(): Promise<string> {
  const supabase = getSupabase()
  for (let i = 0; i < 3; i++) {
    const token = nanoid(16)
    const { data } = await supabase
      .from('trigger_links')
      .select('id')
      .eq('slug', token)
      .maybeSingle()
    if (!data) return token
  }
  throw new Error('Failed to generate unique token after 3 attempts')
}
