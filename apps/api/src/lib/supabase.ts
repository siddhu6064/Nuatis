import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns a Supabase client authenticated with the service role key.
 * Intentionally NOT memoized — tests mock `createClient` per-file with a
 * fresh in-memory store, and a module-level singleton would leak state
 * across test files sharing the same Jest worker process.
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}
