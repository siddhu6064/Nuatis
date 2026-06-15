/**
 * Shared event type for the Ops-Copilot activity pipeline. Extracted to a
 * neutral module so both ops-copilot-client.ts and webhook-retry-worker.ts can
 * import it without forming a circular dependency.
 */
export interface OpsActivityEvent {
  tenant_id: string
  event_id: string
  event_type:
    | 'booking.failed'
    | 'call.failed'
    | 'call.completed'
    | 'lead.stalled'
    | 'appointment.no_show'
    | 'follow_up.missed'
  payload_json: Record<string, unknown>
}
