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
}

export async function scan(): Promise<void> {
  console.info('[incident-sla-scanner] scanning for SLA breaches...')

  try {
    const supabase = getServiceClient()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)
    const now = new Date().toISOString()

    // `sla_breached_at IS NULL` is what makes this fire once. Without it the
    // same open incident would be re-announced every 15 minutes, which is how
    // a team learns to mute the alert.
    const { data, error } = await supabase
      .from('incidents')
      .select('id, tenant_id, reference, severity')
      .lt('sla_due_at', now)
      .is('sla_breached_at', null)
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

    // Stamp before notifying. A crash between the two costs one missed
    // notification; the other order costs a duplicate every 15 minutes
    // forever.
    const { error: updateErr } = await supabase
      .from('incidents')
      .update({ sla_breached_at: now })
      .in(
        'id',
        breached.map((inc) => inc.id)
      )

    if (updateErr) {
      console.error('[incident-sla-scanner] update error:', updateErr.message)
      return
    }

    // One notification per tenant, not per incident — a kitchen that falls
    // behind generates a dozen breaches at once, and a dozen pushes is noise.
    const byTenant = new Map<string, BreachedIncident[]>()
    for (const inc of breached) {
      const list = byTenant.get(inc.tenant_id) ?? []
      list.push(inc)
      byTenant.set(inc.tenant_id, list)
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
      `[incident-sla-scanner] scan complete — ${breached.length} breach(es) across ${byTenant.size} tenant(s)`
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
