import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyPlatformTeam } from '../lib/notify-platform-team.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'platform-ack-scanner'

/** Statuses past the point where acknowledgement still means anything. */
const SETTLED_STATUSES = '(resolved,postmortem_due,closed)'

interface BreachedIncident {
  id: string
  reference: string | null
  severity: string | null
  title: string | null
}

export async function scan(): Promise<void> {
  console.info('[platform-ack-scanner] scanning for missed acknowledgements...')

  try {
    const supabase = getServiceClient()
    const now = new Date().toISOString()

    // `ack_due_at IS NULL` for SEV4 excludes it automatically — `.lt()` never
    // matches null — so best-effort severities need no special case.
    //
    // `ack_breached_at IS NULL` is what makes this fire once. Without it the
    // same unacknowledged incident would be re-announced every five minutes,
    // which is how a team learns to mute the alert.
    const { data, error } = await supabase
      .from('platform_incidents')
      .select('id, reference, severity, title')
      .lt('ack_due_at', now)
      .is('ack_breached_at', null)
      .is('acknowledged_at', null)
      .not('status', 'in', SETTLED_STATUSES)

    if (error) {
      console.error('[platform-ack-scanner] query error:', error.message)
      return
    }

    const breached = (data ?? []) as BreachedIncident[]
    if (breached.length === 0) {
      console.info('[platform-ack-scanner] nothing past its ack deadline')
      return
    }

    // Stamp before notifying. A crash between the two costs one missed
    // escalation; the other order costs a duplicate every five minutes
    // forever.
    const { error: updateErr } = await supabase
      .from('platform_incidents')
      .update({ ack_breached_at: now })
      .in(
        'id',
        breached.map((inc) => inc.id)
      )

    if (updateErr) {
      console.error('[platform-ack-scanner] update error:', updateErr.message)
      return
    }

    // One alert per incident, unlike the tenant-side scanner's per-tenant
    // batching: the platform team is a single audience, and a SEV1 nobody has
    // picked up deserves its own alert rather than a line in a digest.
    //
    // No getPausedTenants here: that is a per-tenant control and these
    // incidents have no tenant.
    for (const inc of breached) {
      console.info(`[platform-ack-scanner] ${inc.reference} missed its ack deadline`)
      // `.catch()` rather than a bare `void`: an unhandled rejection from a
      // fire-and-forget call terminates the worker process, so one failing
      // notification would take the whole scanner down with it.
      void notifyPlatformTeam('platform_incident_ack_missed', {
        title: `${(inc.severity ?? 'incident').toUpperCase()} unacknowledged — ${inc.reference ?? ''}`,
        body: `${inc.title ?? 'An incident'} has passed its acknowledgement deadline with nobody on it.`,
        url: `/admin-console/incidents/${inc.id}`,
      }).catch((err: unknown) => {
        console.error(`[platform-ack-scanner] alert for ${inc.reference} failed:`, err)
      })
    }

    console.info(`[platform-ack-scanner] scan complete — ${breached.length} escalated`)
  } catch (err) {
    console.error('[platform-ack-scanner] scan error:', err)
  }
}

export function createPlatformAckScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[platform-ack-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
