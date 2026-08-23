import { nanoid } from 'nanoid'
import { getServiceClient } from './supabase.js'

// Public trigger-link token: full-alphabet nanoid(16). Never lowercased —
// case-folding nanoid's 64-char alphabet would halve the per-char entropy
// and make tokens enumerable.
export async function generateTriggerToken(): Promise<string> {
  const supabase = getServiceClient()
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
