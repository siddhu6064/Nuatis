import { createClient } from '@supabase/supabase-js'

export interface CallLogEntry {
  tenant_id: string
  duration_seconds: number
  language: string
  timestamp: Date
  phone_number_from?: string
  phone_number_to?: string
  outcome?: string
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export function logCall(entry: CallLogEntry): void {
  console.info(
    JSON.stringify({
      event: 'call_ended',
      tenant_id: entry.tenant_id,
      duration_seconds: entry.duration_seconds,
      language: entry.language,
      timestamp: entry.timestamp.toISOString(),
    })
  )

  const supabase = getSupabase()
  void Promise.resolve(
    supabase.from('calls').insert({
      tenant_id: entry.tenant_id,
      duration_seconds: entry.duration_seconds,
      language: entry.language,
      phone_number_from: entry.phone_number_from ?? null,
      phone_number_to: entry.phone_number_to ?? null,
      outcome: entry.outcome ?? 'completed',
      created_at: entry.timestamp.toISOString(),
    })
  )
    .then(({ error }) => {
      if (error) console.error('[call-logger] Failed to insert call row', error)
    })
    .catch((err: unknown) => {
      console.error('[call-logger] Unexpected error inserting call row', err)
    })
}
