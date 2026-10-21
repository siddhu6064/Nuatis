import { getServiceClient } from './supabase.js'

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const INCIDENT_STATUSES = [
  'open',
  'triaged',
  'in_progress',
  'resolved',
  'cancelled',
] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

/** Minutes from creation to the SLA deadline, by severity. */
export const DEFAULT_SLA_MINUTES: Record<Severity, number> = {
  critical: 60,
  high: 240,
  medium: 60 * 24,
  low: 60 * 24 * 3,
}

/**
 * $10. Above this, a comp needs a manager PIN.
 *
 * The threshold has a known weakness — a cashier who learns it is $10 can comp
 * $9.99 all shift. The mitigation is the per-staff comp total in the manager
 * report, not a lower number: set it low enough and every free coffee needs a
 * manager, which is how people stop reporting anything at all.
 */
export const DEFAULT_AUTH_THRESHOLD_CENTS = 1000

export function slaDueAt(
  severity: Severity,
  now: Date,
  minutesBySeverity: Partial<Record<Severity, number>> = {}
): Date {
  const minutes = minutesBySeverity[severity] ?? DEFAULT_SLA_MINUTES[severity]
  return new Date(now.getTime() + minutes * 60_000)
}

/**
 * Whether this cost needs a second person.
 *
 * Zero is always free: a logged complaint or a noted late order gave nothing
 * away, and prompting for a PIN there just teaches staff not to log them.
 */
export function requiresAuthorisation(costCents: number, thresholdCents: number): boolean {
  if (costCents <= 0) return false
  return costCents >= thresholdCents
}

/**
 * Explicit transition map, the same shape routes/orders.ts uses. A status
 * change is an API operation and the rule belongs where the transition is
 * validated, not in the UI.
 *
 * A status is never listed as its own successor, so a no-op is refused and an
 * incident_events row is never written for a change that did not happen.
 */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['triaged', 'in_progress', 'resolved', 'cancelled'],
  triaged: ['in_progress', 'resolved', 'cancelled'],
  in_progress: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * INC-#### per tenant. Mirrors generateOrderNumber's counter pattern; the
 * unique index on (tenant_id, reference) is the real guard against the
 * select-then-update race, which is acceptable at incident volumes.
 *
 * Reads the newest incident rather than scanning them all: references only ever
 * increase, so the most recently created row carries the highest number.
 */
export async function generateIncidentReference(tenantId: string): Promise<string> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('incidents')
    .select('reference')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)

  const rows = (data ?? []) as { reference: string }[]
  const last = rows[0]?.reference ?? 'INC-1000'
  // Defensive parse: a hand-edited or imported reference must not produce
  // "INC-NaN" and collide with itself on every subsequent insert.
  const parsed = Number(String(last).replace(/^INC-/, ''))
  const n = Number.isFinite(parsed) ? parsed : 1000
  return `INC-${n + 1}`
}
