import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { sendPushNotification } from '../lib/push-client.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const QUEUE_NAME = 'no-show-scanner'
const GRACE_MINUTES = 15
const MAX_AGE_HOURS = 24

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function scan(): Promise<void> {
  console.info('[no-show-scanner] scanning for no-shows...')

  try {
    const supabase = getSupabase()
    const now = Date.now()
    const graceEnd = new Date(now - GRACE_MINUTES * 60000).toISOString()
    const maxAge = new Date(now - MAX_AGE_HOURS * 3600000).toISOString()

    // Find appointments: status = 'scheduled', end_time passed 15+ min ago, within last 24h
    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('id, tenant_id, contact_id, start_time, end_time')
      .eq('status', 'scheduled')
      .lt('end_time', graceEnd)
      .gt('end_time', maxAge)

    if (error) {
      console.error(`[no-show-scanner] query error: ${error.message}`)
      return
    }

    if (!appointments || appointments.length === 0) {
      console.info('[no-show-scanner] found 0 no-show appointments')
      console.info('[no-show-scanner] scan complete')
      return
    }

    console.info(`[no-show-scanner] found ${appointments.length} no-show appointments`)
    const apiKey = process.env['TELNYX_API_KEY'] ?? ''

    for (const appt of appointments) {
      // Mark as no_show
      const { error: updateErr } = await supabase
        .from('appointments')
        .update({ status: 'no_show' })
        .eq('id', appt.id)

      if (updateErr) {
        console.error(
          `[no-show-scanner] failed to update appointment=${appt.id}: ${updateErr.message}`
        )
        continue
      }

      // Look up contact name
      let contactName = 'Unknown'
      if (appt.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('full_name')
          .eq('id', appt.contact_id)
          .single()
        if (contact) contactName = contact.full_name || 'Unknown'
      }

      // Emit event
      void publishActivityEvent({
        tenant_id: appt.tenant_id,
        event_id: appt.id,
        event_type: 'appointment.no_show',
        payload_json: {
          severity: 'high',
          appointment_id: appt.id,
          contact_id: appt.contact_id,
          contact_name: contactName,
          scheduled_at: appt.start_time,
          source_event_id: appt.id,
        },
      })

      console.info(
        `[no-show-scanner] marked noshow + emitted event: appointment=${appt.id} tenant=${appt.tenant_id}`
      )

      void dispatchWebhook(appt.tenant_id, 'appointment.no_show', {
        appointment_id: appt.id,
        contact_id: appt.contact_id,
        contact_name: contactName,
        scheduled_at: appt.start_time,
      })

      void sendPushNotification(appt.tenant_id, {
        title: 'No Show',
        body: `${contactName} missed their appointment`,
        url: '/calls',
      })

      // Send rebook SMS (best-effort)
      if (apiKey && appt.contact_id) {
        try {
          const { data: contact } = await supabase
            .from('contacts')
            .select('phone')
            .eq('id', appt.contact_id)
            .single()

          const { data: location } = await supabase
            .from('locations')
            .select('telnyx_number')
            .eq('tenant_id', appt.tenant_id)
            .eq('is_primary', true)
            .maybeSingle()

          const toPhone = contact?.phone
          const fromNumber = location?.telnyx_number

          if (toPhone && fromNumber) {
            const smsText = `We missed you today! Would you like to rebook? Reply YES or call us at ${fromNumber}.`

            const res = await fetch('https://api.telnyx.com/v2/messages', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ from: fromNumber, to: toPhone, text: smsText }),
            })

            if (res.ok) {
              console.info(`[no-show-scanner] rebook SMS sent to=${toPhone} appointment=${appt.id}`)
            } else {
              const body = await res.text()
              console.error(`[no-show-scanner] rebook SMS failed (${res.status}): ${body}`)
            }
          }
        } catch (smsErr) {
          console.error(`[no-show-scanner] rebook SMS error for appointment=${appt.id}:`, smsErr)
        }
      }
    }

    console.info('[no-show-scanner] scan complete')
  } catch (err) {
    console.error('[no-show-scanner] scan error:', err)
  }
}

export function createNoShowScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[no-show-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
