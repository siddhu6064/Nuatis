export const PLATFORM_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const
export type PlatformSeverity = (typeof PLATFORM_SEVERITIES)[number]

export const PLATFORM_STATUSES = [
  'detected',
  'acknowledged',
  'mitigating',
  'resolved',
  'postmortem_due',
  'closed',
] as const
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number]

export const COMPONENTS = ['api', 'pos-socket', 'database', 'worker', 'web'] as const

export interface PlatformIncident {
  id: string
  reference: string
  severity: PlatformSeverity
  status: PlatformStatus
  title: string
  summary: string | null
  component: string | null
  assigned_to_user_id: string | null
  detected_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  postmortem: string | null
  postmortem_due_at: string | null
  ack_due_at: string | null
  customer_message: string | null
  customer_message_published_at: string | null
}

export interface PlatformIncidentEvent {
  id: string
  at: string
  actor_kind: 'user' | 'system'
  kind: string
  detail: Record<string, unknown>
}

/**
 * Colour by severity, so a SEV1 is findable without reading the row.
 *
 * SEV1 means merchants cannot take money, so it gets the loudest colour the
 * palette has.
 */
export function severityColor(
  severity: PlatformSeverity
): 'default' | 'info' | 'warning' | 'error' {
  if (severity === 'sev1') return 'error'
  if (severity === 'sev2') return 'warning'
  if (severity === 'sev3') return 'info'
  return 'default'
}

/**
 * "10m to ack" or "20m over", from the deadline and now.
 *
 * Returns an empty string when there is no deadline — SEV4 is best effort, and
 * rendering "no deadline" as a countdown would imply one exists.
 */
export function ackCountdownLabel(ackDueAt: string | null, now: Date): string {
  if (!ackDueAt) return ''
  const deltaMs = Date.parse(ackDueAt) - now.getTime()
  if (!Number.isFinite(deltaMs)) return ''
  const minutes = Math.round(Math.abs(deltaMs) / 60_000)
  return deltaMs >= 0 ? `${minutes}m to ack` : `${minutes}m over`
}

/**
 * Whether the UI should offer a Close button.
 *
 * Mirrors the API's transition map and its written-postmortem check. The gate
 * lives in the API — this exists so the button is not offered and then
 * rejected, which reads as a bug rather than a rule.
 */
export function canCloseFromUi(incident: {
  severity: PlatformSeverity
  status: PlatformStatus
  postmortem: string | null
}): boolean {
  if (incident.status !== 'resolved' && incident.status !== 'postmortem_due') return false
  const owesPostmortem = incident.severity === 'sev1' || incident.severity === 'sev2'
  if (!owesPostmortem) return true
  // A SEV1/SEV2 must reach postmortem_due first AND have text written.
  if (incident.status !== 'postmortem_due') return false
  return (incident.postmortem ?? '').trim().length > 0
}
