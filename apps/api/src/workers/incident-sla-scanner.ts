import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'incident-sla-scanner'

/** Statuses that end an incident's life — an SLA no longer applies to them. */
const CLOSED_STATUSES = '(resolved,cancelled)'

interface BreachedIncident {
  id: string
  tenant_id: string
  reference: string | null
  severity: string | null
  type_key: string | null
  assigned_to_user_id: string | null
  sla_breached_at: string | null
}

interface RuleRow {
  id: string
  tenant_id: string
  when_event: string
  match_type_key: string | null
  match_severity: string | null
  action: string
  target_user_id: string | null
  delay_minutes: number | null
  enabled: boolean
}

/**
 * Apply a tenant's escalation rules to incidents that have breached.
 *
 * Rules are loaded tenant-scoped. A rule with a null match field matches
 * anything for that field, so a rule with both null applies to every incident
 * at this event.
 *
 * `nowMs` is passed in rather than read here so every incident in one scan is
 * judged against the same instant.
 */
export async function applyRules(
  tenantId: string,
  incidents: BreachedIncident[],
  when: 'created' | 'breached' | 'unassigned',
  nowMs: number
): Promise<void> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('incident_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('when_event', when)
    .eq('enabled', true)

  if (error) {
    console.error('[incident-sla-scanner] rule query error:', error.message)
    return
  }

  const rules = (data ?? []) as RuleRow[]
  if (rules.length === 0) return

  // Which (incident, rule) pairs have already fired. The scanner revisits
  // breached incidents on every tick so delayed rules can fire late, which
  // means "has this rule already acted?" can no longer be inferred from the
  // incident row alone — the append-only event log is the record.
  const alreadyFired = new Set<string>()
  const { data: priorEvents } = await supabase
    .from('incident_events')
    .select('incident_id, detail')
    .eq('tenant_id', tenantId)
    .in(
      'incident_id',
      incidents.map((inc) => inc.id)
    )

  for (const ev of (priorEvents ?? []) as { incident_id: string; detail: unknown }[]) {
    const byRule = (ev.detail as Record<string, unknown> | null)?.['by_rule']
    if (typeof byRule === 'string') alreadyFired.add(`${ev.incident_id}|${byRule}`)
  }

  for (const inc of incidents) {
    // An incident revisited before it was ever stamped is being handled in the
    // same pass that stamps it, so treat its breach as happening now.
    const breachedMs = inc.sla_breached_at ? Date.parse(inc.sla_breached_at) : nowMs

    for (const rule of rules) {
      if (rule.match_severity && rule.match_severity !== inc.severity) continue
      if (rule.match_type_key && rule.match_type_key !== inc.type_key) continue
      if (alreadyFired.has(`${inc.id}|${rule.id}`)) continue

      // "Escalate if nobody has picked this up in 30 minutes" only means
      // anything if the delay is actually waited out.
      const delayMs = (rule.delay_minutes ?? 0) * 60_000
      if (delayMs > 0 && nowMs - breachedMs < delayMs) continue

      if (rule.action === 'assign_to' && rule.target_user_id) {
        // Never take work off a person who already picked it up. A rule that
        // reassigns someone's incident out from under them is how a team
        // decides the automation is more trouble than it is worth.
        if (inc.assigned_to_user_id) continue

        await supabase
          .from('incidents')
          .update({ assigned_to_user_id: rule.target_user_id })
          .eq('id', inc.id)
          .eq('tenant_id', tenantId)

        await supabase.from('incident_events').insert({
          tenant_id: tenantId,
          incident_id: inc.id,
          actor_kind: 'system',
          actor_id: null,
          kind: 'assigned',
          detail: { by_rule: rule.id, assigned_to_user_id: rule.target_user_id },
        })

        // Keep the in-memory copy honest so a second matching rule sees it as
        // taken rather than assigning over it.
        inc.assigned_to_user_id = rule.target_user_id
        alreadyFired.add(`${inc.id}|${rule.id}`)
        continue
      }

      if (rule.action === 'notify_owner') {
        void notifyOwner(tenantId, 'incident_escalated', {
          pushTitle: 'Incident escalated',
          pushBody: `${inc.reference ?? 'An incident'} (${inc.severity ?? 'unknown'}) is still open past its SLA.`,
          pushUrl: '/incidents',
        })

        await supabase.from('incident_events').insert({
          tenant_id: tenantId,
          incident_id: inc.id,
          actor_kind: 'system',
          actor_id: null,
          kind: 'escalated',
          detail: { by_rule: rule.id, action: 'notify_owner' },
        })

        alreadyFired.add(`${inc.id}|${rule.id}`)
      }
    }
  }
}

export async function scan(): Promise<void> {
  console.info('[incident-sla-scanner] scanning for SLA breaches...')

  try {
    const supabase = getServiceClient()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)
    const now = new Date().toISOString()

    // Every open incident past its deadline, breached-and-stamped ones
    // included: a delayed escalation rule has to be able to fire on a tick
    // long after the breach itself. `sla_breached_at` is carried through so
    // the once-only notification below can still tell new from old.
    const { data, error } = await supabase
      .from('incidents')
      .select('id, tenant_id, reference, severity, type_key, assigned_to_user_id, sla_breached_at')
      .lt('sla_due_at', now)
      .not('status', 'in', CLOSED_STATUSES)

    if (error) {
      console.error('[incident-sla-scanner] query error:', error.message)
      return
    }

    const rows = (data ?? []) as BreachedIncident[]
    if (rows.length === 0) {
      console.info('[incident-sla-scanner] no SLA breaches found')
      return
    }

    // Paused tenants are skipped *before* the stamp, not after. Stamping a
    // paused tenant's incident would mean unpausing silently swallows the
    // alert: the row already reads as breached, so it never fires again.
    const breached = rows.filter((inc) => !pausedTenants.has(inc.tenant_id))
    if (breached.length === 0) {
      console.info('[incident-sla-scanner] all affected tenants are paused')
      return
    }

    // Only the rows crossing the line on this tick get announced. The rest are
    // carried along for their escalation rules, not to be re-announced — a
    // breach re-announced every 15 minutes is how a team learns to mute the
    // alert.
    const newlyBreached = breached.filter((inc) => inc.sla_breached_at == null)

    // Stamp before notifying. A crash between the two costs one missed
    // notification; the other order costs a duplicate every 15 minutes
    // forever.
    if (newlyBreached.length > 0) {
      const { error: updateErr } = await supabase
        .from('incidents')
        .update({ sla_breached_at: now })
        .in(
          'id',
          newlyBreached.map((inc) => inc.id)
        )

      if (updateErr) {
        console.error('[incident-sla-scanner] update error:', updateErr.message)
        return
      }
    }

    // One notification per tenant, not per incident — a kitchen that falls
    // behind generates a dozen breaches at once, and a dozen pushes is noise.
    const byTenant = new Map<string, BreachedIncident[]>()
    for (const inc of newlyBreached) {
      const list = byTenant.get(inc.tenant_id) ?? []
      list.push(inc)
      byTenant.set(inc.tenant_id, list)
    }

    // Rules run over every breached incident, not just the new ones, so a
    // delayed rule reaches its moment. Grouped by tenant because rules are
    // loaded per tenant.
    const rulesByTenant = new Map<string, BreachedIncident[]>()
    for (const inc of breached) {
      const list = rulesByTenant.get(inc.tenant_id) ?? []
      list.push(inc)
      rulesByTenant.set(inc.tenant_id, list)
    }
    const nowMs = Date.parse(now)
    for (const [tenantId, incidents] of rulesByTenant) {
      await applyRules(tenantId, incidents, 'breached', nowMs)
    }

    for (const [tenantId, incidents] of byTenant) {
      const count = incidents.length
      const noun = count === 1 ? 'incident' : 'incidents'
      const first = incidents[0]
      const detail =
        count === 1 && first?.reference
          ? `${first.reference} (${first.severity ?? 'unknown'}) has passed its resolution deadline.`
          : `${count} open ${noun} have passed their resolution deadlines.`

      console.info(`[incident-sla-scanner] ${count} SLA breach(es) for tenant ${tenantId}`)

      // No smsBody: lib/notifications.ts has its SMS branch commented out
      // pending a personal phone field on users, so passing one would imply a
      // channel that does not work.
      void notifyOwner(tenantId, 'incident_sla_breach', {
        pushTitle: `${count} ${noun} past SLA`,
        pushBody: detail,
        pushUrl: '/incidents',
      })
    }

    console.info(
      `[incident-sla-scanner] scan complete — ${newlyBreached.length} new breach(es), ${breached.length} open past SLA`
    )
  } catch (err) {
    console.error('[incident-sla-scanner] scan error:', err)
  }
}

export function createIncidentSlaScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[incident-sla-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
