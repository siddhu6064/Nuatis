import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'lead-stalled-scanner'
const STALE_DAYS = 7
const TERMINAL_STATUSES = ['won', 'lost']

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function scan(): Promise<void> {
  console.info('[lead-stalled-scanner] scanning for stalled leads...')

  try {
    const supabase = getSupabase()
    const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()

    // Find contacts whose last activity (updated_at or last_contacted) is older than 7 days
    // and who are not archived
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, tenant_id, full_name, updated_at, last_contacted')
      .eq('is_archived', false)
      .lt('updated_at', cutoff)

    if (error) {
      console.error(`[lead-stalled-scanner] query error: ${error.message}`)
      return
    }

    if (!contacts || contacts.length === 0) {
      console.info('[lead-stalled-scanner] found 0 stalled leads')
      console.info('[lead-stalled-scanner] scan complete')
      return
    }

    // Filter: only include contacts where BOTH updated_at and last_contacted are stale
    // (last_contacted may be null — treat null as stale)
    const now = Date.now()
    const stalled = contacts.filter((c) => {
      const lastActivity = c.last_contacted
        ? Math.max(new Date(c.updated_at).getTime(), new Date(c.last_contacted).getTime())
        : new Date(c.updated_at).getTime()
      return now - lastActivity >= STALE_DAYS * 86400000
    })

    // For each stalled contact, look up their pipeline entry to get current stage
    const tenantIds = new Set<string>()
    let emitted = 0

    for (const contact of stalled) {
      tenantIds.add(contact.tenant_id)

      const lastActivity = contact.last_contacted
        ? Math.max(
            new Date(contact.updated_at).getTime(),
            new Date(contact.last_contacted).getTime()
          )
        : new Date(contact.updated_at).getTime()
      const daysStalled = Math.floor((now - lastActivity) / 86400000)

      // Check pipeline entry status — skip terminal (won/lost)
      const { data: entry } = await supabase
        .from('pipeline_entries')
        .select('status, pipeline_stages(name)')
        .eq('contact_id', contact.id)
        .eq('tenant_id', contact.tenant_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (entry && TERMINAL_STATUSES.includes(entry.status)) continue

      const stageName =
        entry?.pipeline_stages &&
        typeof entry.pipeline_stages === 'object' &&
        'name' in entry.pipeline_stages
          ? String((entry.pipeline_stages as { name: string }).name)
          : 'unknown'

      void publishActivityEvent({
        tenant_id: contact.tenant_id,
        event_id: contact.id,
        event_type: 'lead.stalled',
        payload_json: {
          severity: 'high',
          days_stalled: daysStalled,
          lead_id: contact.id,
          stage: stageName,
          contact_name: contact.full_name || 'Unknown',
          source_event_id: contact.id,
        },
      })

      emitted++
      console.info(
        `[lead-stalled-scanner] emitted lead.stalled for contact=${contact.id} tenant=${contact.tenant_id} days=${daysStalled}`
      )
    }

    console.info(
      `[lead-stalled-scanner] found ${emitted} stalled leads across ${tenantIds.size} tenants`
    )
    console.info('[lead-stalled-scanner] scan complete')
  } catch (err) {
    console.error('[lead-stalled-scanner] scan error:', err)
  }
}

export function createLeadStalledScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[lead-stalled-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
