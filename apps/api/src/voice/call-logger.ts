import { getServiceClient } from '../lib/supabase.js'

export interface CallLogEntry {
  tenant_id: string
  duration_seconds: number
  language: string
  timestamp: Date
  phone_number_from?: string
  phone_number_to?: string
  outcome?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  if (!UUID_RE.test(entry.tenant_id)) {
    console.warn(
      `[call-logger] skipping DB insert — tenant_id is not a valid UUID: "${entry.tenant_id}"`
    )
    return
  }

  const supabase = getServiceClient()
  void Promise.resolve(
    supabase.from('calls').insert({
      tenant_id: entry.tenant_id,
      duration_seconds: entry.duration_seconds,
      language: entry.language,
      caller_number: entry.phone_number_from ?? '',
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
