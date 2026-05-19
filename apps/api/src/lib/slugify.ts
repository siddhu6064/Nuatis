import { nanoid } from 'nanoid'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function generateTriggerSlug(): Promise<string> {
  const supabase = getSupabase()
  for (let i = 0; i < 3; i++) {
    const slug = nanoid(8).toLowerCase()
    const { data } = await supabase
      .from('trigger_links')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (!data) return slug
  }
  throw new Error('Failed to generate unique slug after 3 attempts')
}
