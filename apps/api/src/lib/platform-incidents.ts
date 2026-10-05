import { getServiceClient } from './supabase.js'

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

/**
 * Minutes from detection to the acknowledgement deadline.
 *
 * SEV1 is anchored to money — merchants cannot take payment — not to a
 * component. The POS socket dropping is a SEV2: the kitchen screen stops
 * updating but the register still takes payment. Anchoring the top severity to
 * revenue is what stops the scale drifting.
 *
 * SEV4 is null rather than a large number: best effort, no deadline. A deadline
 * nobody intends to meet is noise that teaches people to ignore the real ones.
 */
export const ACK_TARGET_MINUTES: Record<PlatformSeverity, number | null> = {
  sev1: 15,
  sev2: 60,
  sev3: 60 * 8,
  sev4: null,
}

export function ackDueAt(severity: PlatformSeverity, detectedAt: Date): Date | null {
  const minutes = ACK_TARGET_MINUTES[severity]
  if (minutes === null) return null
  return new Date(detectedAt.getTime() + minutes * 60_000)
}

/** SEV1 and SEV2 must be written up before they can be closed. */
export function requiresPostmortem(severity: PlatformSeverity): boolean {
  return severity === 'sev1' || severity === 'sev2'
}

/**
 * Explicit transition map, the same shape routes/orders.ts uses.
 *
 * A status is never its own successor, so a no-op is refused and no event row
 * is written for a change that did not happen. Nothing moves backwards: status
 * is a record of what happened, not a cursor someone drags around. `closed` has
 * no successors — a new problem is a new incident, not a resurrected one.
 */
const BASE_TRANSITIONS: Record<PlatformStatus, PlatformStatus[]> = {
  detected: ['acknowledged', 'mitigating', 'resolved'],
  acknowledged: ['mitigating', 'resolved'],
  mitigating: ['resolved'],
  resolved: ['postmortem_due', 'closed'],
  postmortem_due: ['closed'],
  closed: [],
}

export function canTransition(
  from: PlatformStatus,
  to: PlatformStatus,
  severity: PlatformSeverity
): boolean {
  if (!BASE_TRANSITIONS[from].includes(to)) return false
  // The gate: a severity that owes a postmortem cannot jump resolved -> closed.
  if (from === 'resolved' && to === 'closed' && requiresPostmortem(severity)) return false
  return true
}

/**
 * SEV-YYYY-NNN, counting within the calendar year.
 *
 * Mirrors generateIncidentReference's counter pattern from sub-project A. The
 * unique index on `reference` is the real guard against the select-then-insert
 * race, which is acceptable at the volume of incidents a platform team declares
 * by hand.
 */
export async function generatePlatformReference(now: Date): Promise<string> {
  const supabase = getServiceClient()
  const year = now.getUTCFullYear()
  const prefix = `SEV-${year}-`

  const { data } = await supabase
    .from('platform_incidents')
    .select('reference')
    .like('reference', `${prefix}%`)

  // Max taken numerically, not by string order. The suffix is zero-padded to
  // three, so once a year reaches SEV-YYYY-1000 the string order inverts —
  // "SEV-2026-1000" sorts below "SEV-2026-999" — and ordering by reference
  // would hand back 999 forever, colliding on the unique index every time. A
  // platform team's incidents-per-year is small enough to scan.
  let highest = 0
  for (const row of (data ?? []) as { reference: string }[]) {
    // Defensive parse: a hand-edited reference must not produce SEV-2026-NaN
    // and then collide with itself on every subsequent insert.
    const parsed = Number(row.reference.slice(prefix.length))
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`
}
