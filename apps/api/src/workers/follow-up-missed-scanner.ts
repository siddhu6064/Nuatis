import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { sendPushNotification } from '../lib/push-client.js'

const QUEUE_NAME = 'follow-up-missed-scanner'
const MIN_DAYS = 2
const MAX_DAYS = 7

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ContactFollowUp {
  contact_id: string
  tenant_id: string
  full_name: string
  last_contact_date: string
}

export async function scan(): Promise<void> {
  console.info('[follow-up-missed-scanner] scanning for missed follow-ups...')

  try {
    const supabase = getSupabase()
    const now = Date.now()
    const minCutoff = new Date(now - MAX_DAYS * 86400000).toISOString()
    const maxCutoff = new Date(now - MIN_DAYS * 86400000).toISOString()

    // Step 1: Find voice sessions that ended 2-7 days ago with a contact_id
    const { data: sessions, error: sessErr } = await supabase
      .from('voice_sessions')
      .select('contact_id, tenant_id, ended_at')
      .not('contact_id', 'is', null)
      .gte('ended_at', minCutoff)
      .lte('ended_at', maxCutoff)

    if (sessErr) {
      console.error(`[follow-up-missed-scanner] voice_sessions query error: ${sessErr.message}`)
      return
    }

    // Step 2: Find completed appointments that ended 2-7 days ago
    const { data: completedAppts, error: apptErr } = await supabase
      .from('appointments')
      .select('contact_id, tenant_id, end_time')
      .eq('status', 'completed')
      .gte('end_time', minCutoff)
      .lte('end_time', maxCutoff)

    if (apptErr) {
      console.error(`[follow-up-missed-scanner] appointments query error: ${apptErr.message}`)
      return
    }

    // Merge into a deduplicated map: contact_id -> { tenant_id, last_contact_date }
    const contactMap = new Map<string, { tenant_id: string; last_contact_date: string }>()

    for (const s of sessions ?? []) {
      if (!s.contact_id) continue
      const existing = contactMap.get(s.contact_id)
      if (!existing || new Date(s.ended_at) > new Date(existing.last_contact_date)) {
        contactMap.set(s.contact_id, { tenant_id: s.tenant_id, last_contact_date: s.ended_at })
      }
    }

    for (const a of completedAppts ?? []) {
      if (!a.contact_id) continue
      const existing = contactMap.get(a.contact_id)
      if (!existing || new Date(a.end_time) > new Date(existing.last_contact_date)) {
        contactMap.set(a.contact_id, { tenant_id: a.tenant_id, last_contact_date: a.end_time })
      }
    }

    if (contactMap.size === 0) {
      console.info('[follow-up-missed-scanner] found 0 contacts with missed follow-ups')
      console.info('[follow-up-missed-scanner] scan complete')
      return
    }

    // Step 3: For each contact, check if there's any NEWER activity
    const missed: ContactFollowUp[] = []

    for (const [contactId, info] of contactMap) {
      // Check for newer voice session
      const { data: newerSession } = await supabase
        .from('voice_sessions')
        .select('id')
        .eq('contact_id', contactId)
        .gt('started_at', info.last_contact_date)
        .limit(1)
        .maybeSingle()

      if (newerSession) continue

      // Check for newer appointment
      const { data: newerAppt } = await supabase
        .from('appointments')
        .select('id')
        .eq('contact_id', contactId)
        .gt('start_time', info.last_contact_date)
        .limit(1)
        .maybeSingle()

      if (newerAppt) continue

      // No follow-up — look up contact name
      const { data: contact } = await supabase
        .from('contacts')
        .select('full_name')
        .eq('id', contactId)
        .single()

      missed.push({
        contact_id: contactId,
        tenant_id: info.tenant_id,
        full_name: contact?.full_name || 'Unknown',
        last_contact_date: info.last_contact_date,
      })
    }

    // Step 4: Emit events
    for (const m of missed) {
      const hoursSince = Math.floor((now - new Date(m.last_contact_date).getTime()) / 3600000)

      void publishActivityEvent({
        tenant_id: m.tenant_id,
        event_id: m.contact_id,
        event_type: 'follow_up.missed',
        payload_json: {
          severity: 'high',
          contact_id: m.contact_id,
          contact_name: m.full_name,
          last_contact_date: m.last_contact_date,
          hours_since_contact: hoursSince,
          source_event_id: m.contact_id,
        },
      })

      void sendPushNotification(m.tenant_id, {
        title: 'Follow-up Needed',
        body: `${m.full_name} hasn't been contacted in ${Math.floor(hoursSince / 24)} days`,
        url: '/automation',
      })
    }

    console.info(
      `[follow-up-missed-scanner] found ${missed.length} contacts with missed follow-ups`
    )
    console.info('[follow-up-missed-scanner] scan complete')
  } catch (err) {
    console.error('[follow-up-missed-scanner] scan error:', err)
  }
}

export function createFollowUpMissedScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[follow-up-missed-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
