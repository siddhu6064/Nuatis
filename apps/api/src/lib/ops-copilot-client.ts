import { randomUUID } from 'crypto'

export interface OpsActivityEvent {
  tenant_id: string
  event_id: string
  event_type:
    | 'booking.failed'
    | 'call.failed'
    | 'lead.stalled'
    | 'appointment.no_show'
    | 'follow_up.missed'
  payload_json: Record<string, unknown>
}

/**
 * Fire-and-forget publish to the Nuatis-Ops-Copilot sidecar.
 * Never throws — all failures are silently logged so the caller's job is never blocked.
 */
export async function publishActivityEvent(payload: OpsActivityEvent): Promise<void> {
  const baseUrl = process.env['OPS_COPILOT_URL'] ?? 'http://localhost:8001'
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(`${baseUrl}/internal/events/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activity_event_id: randomUUID(),
        tenant_id: payload.tenant_id,
        event_id: payload.event_id,
        event_type: payload.event_type,
        event_source: 'nuatis_crm',
        occurred_at: new Date().toISOString(),
        payload_json: payload.payload_json,
      }),
      signal: controller.signal,
    })

    if (res.status !== 201) {
      console.warn(
        `[ops-copilot] Non-201 response: ${res.status} (event_type=${payload.event_type}, event_id=${payload.event_id})`
      )
    }
  } catch (err: unknown) {
    console.warn('[ops-copilot] Failed to publish activity event:', err)
  } finally {
    clearTimeout(timeoutHandle)
  }
}
