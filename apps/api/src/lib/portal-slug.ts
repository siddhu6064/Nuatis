import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function generateRandomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
}

export async function generatePortalSlug(tenantId: string, businessName: string): Promise<string> {
  if (!tenantId) throw new Error('tenantId is required')
  const supabase = getSupabase()

  // Step 1: Slugify the business name
  let slug = slugify(businessName || '')
  if (!slug) slug = 'portal'

  // Step 2: Check collision (excluding own tenant)
  const check1 = await supabase
    .from('tenants')
    .select('id')
    .eq('portal_slug', slug)
    .neq('id', tenantId)
    .maybeSingle()
  if (!check1.data) {
    await supabase.from('tenants').update({ portal_slug: slug }).eq('id', tenantId)
    return slug
  }

  // Step 3: Collision — append 4 random hex chars, retry once
  let finalSlug = `${slug}-${generateRandomHex(4)}`
  const check2 = await supabase
    .from('tenants')
    .select('id')
    .eq('portal_slug', finalSlug)
    .neq('id', tenantId)
    .maybeSingle()
  if (!check2.data) {
    await supabase.from('tenants').update({ portal_slug: finalSlug }).eq('id', tenantId)
    return finalSlug
  }

  // Step 3b: Still collides — use tenantId prefix as guaranteed-unique suffix
  finalSlug = `${slug}-${tenantId.slice(0, 8)}`
  await supabase.from('tenants').update({ portal_slug: finalSlug }).eq('id', tenantId)
  return finalSlug
}
