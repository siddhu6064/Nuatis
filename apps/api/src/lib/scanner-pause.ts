import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/** Returns true if the tenant has an active pause for this scanner right now. */
export async function isScannerPaused(tenantId: string, scannerKey: string): Promise<boolean> {
  const supabase = getSupabase()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('scanner_pauses')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('scanner_key', scannerKey)
    .lte('paused_from', now)
    .gte('paused_until', now)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error(`[scanner-pause] isScannerPaused error: ${error.message}`)
    return false
  }
  return data !== null
}

/** Returns the active pause row for this tenant+scanner, or null if none. */
export async function getActivePause(tenantId: string, scannerKey: string) {
  const supabase = getSupabase()
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('scanner_pauses')
    .select('id, paused_from, paused_until, reason')
    .eq('tenant_id', tenantId)
    .eq('scanner_key', scannerKey)
    .lte('paused_from', now)
    .gte('paused_until', now)
    .order('paused_until', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

/**
 * Returns a Set of tenant IDs that have an active pause for this scannerKey right now.
 * Used by batch scanners that process all tenants in a single scan().
 */
export async function getPausedTenants(scannerKey: string): Promise<Set<string>> {
  const supabase = getSupabase()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('scanner_pauses')
    .select('tenant_id')
    .eq('scanner_key', scannerKey)
    .lte('paused_from', now)
    .gte('paused_until', now)
  if (error) {
    console.error(`[scanner-pause] getPausedTenants error: ${error.message}`)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.tenant_id as string))
}
