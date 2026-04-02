export interface CallLogEntry {
  tenant_id: string
  duration_seconds: number
  language: string
  timestamp: Date
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
  // TODO: write to calls table (next task)
}
