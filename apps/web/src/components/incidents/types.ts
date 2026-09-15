export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const STATUSES = ['open', 'triaged', 'in_progress', 'resolved', 'cancelled'] as const
export type IncidentStatus = (typeof STATUSES)[number]

export interface Incident {
  id: string
  reference: string
  type_key: string
  severity: Severity
  status: IncidentStatus
  title: string
  description: string | null
  cost_cents: number
  assigned_to_user_id: string | null
  sla_due_at: string | null
  resolved_at: string | null
  root_cause: string | null
  resolution_notes: string | null
  created_at: string
}

export interface IncidentEvent {
  id: string
  at: string
  actor_kind: 'staff' | 'user' | 'system'
  kind: string
  detail: Record<string, unknown>
}

/** Integer cents to a display string. Never float arithmetic on money. */
export function toDollars(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Colour by severity, so a critical row is findable without reading it. */
export const SEVERITY_COLOR: Record<Severity, 'default' | 'info' | 'warning' | 'error'> = {
  low: 'default',
  medium: 'info',
  high: 'warning',
  critical: 'error',
}

/** Past its SLA and still live. Resolved and cancelled are never overdue. */
export function isOverdue(incident: Incident, now: number = Date.now()): boolean {
  if (incident.status === 'resolved' || incident.status === 'cancelled') return false
  if (!incident.sla_due_at) return false
  const due = Date.parse(incident.sla_due_at)
  return Number.isFinite(due) && due < now
}
