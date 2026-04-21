import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fetch the tenant's business name with a hard 400ms timeout.
 *
 * A slow Supabase response must never delay call pickup — the caller hears
 * "our office" on timeout rather than dead air while the query finishes.
 * Fires a single console.warn so the timeout is visible in Sentry/logs.
 */
export async function getTenantBusinessName(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string> {
  let timedOut = false
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => {
      timedOut = true
      console.warn(
        `[tenant-helpers] getTenantBusinessName 400ms timeout — tenant=${tenantId} (using fallback)`
      )
      resolve('our office')
    }, 400)
  )

  const query: Promise<string> = (async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .single()
      if (timedOut) return 'our office'
      if (error || !data) return 'our office'
      return (data as { name?: string }).name ?? 'our office'
    } catch {
      return 'our office'
    }
  })()

  return Promise.race([query, timeout])
}
