import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS, type FollowUpStep } from '@nuatis/shared'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { sendTemplatedEmail } from '../lib/email-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'

const QUEUE_NAME = 'follow-up-cadence'
const MAX_LOOKBACK_DAYS = 14

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function sendSms(from: string, to: string, text: string): Promise<boolean> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) return false

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, text }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[follow-up-cadence] SMS failed (${res.status}): ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[follow-up-cadence] SMS error:', err)
    return false
  }
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
}

export async function scan(): Promise<void> {
  console.info('[follow-up-cadence] scanning for contacts due for follow-up...')

  try {
    const supabase = getSupabase()
    const now = Date.now()
    const lookbackCutoff = new Date(now - MAX_LOOKBACK_DAYS * 86400000).toISOString()

    // Find contacts created or contacted recently who might need follow-ups
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select(
        'id, tenant_id, full_name, phone, email, follow_up_step, follow_up_last_sent, created_at'
      )
      .eq('is_archived', false)
      .gte('created_at', lookbackCutoff)

    if (error) {
      console.error(`[follow-up-cadence] contacts query error: ${error.message}`)
      return
    }

    if (!contacts || contacts.length === 0) {
      console.info('[follow-up-cadence] scan complete: sent 0 follow-ups')
      return
    }

    let sentCount = 0

    for (const contact of contacts) {
      try {
        const step = contact.follow_up_step ?? 0

        // Get tenant's vertical to find cadence
        const { data: tenant } = await supabase
          .from('tenants')
          .select('vertical, name')
          .eq('id', contact.tenant_id)
          .single()

        if (!tenant) continue

        const verticalConfig = VERTICALS[tenant.vertical]
        if (!verticalConfig) continue

        const cadence = verticalConfig.follow_up_cadence
        if (!cadence || step >= cadence.length) continue

        const currentStep: FollowUpStep = cadence[step]!

        // Check if enough days have passed since contact creation (for step 0)
        // or since last follow-up (for subsequent steps)
        const referenceDate = contact.follow_up_last_sent
          ? new Date(contact.follow_up_last_sent).getTime()
          : new Date(contact.created_at).getTime()

        const daysSinceRef = (now - referenceDate) / 86400000
        if (daysSinceRef < currentStep.days_after) continue

        // Check if contact has booked an appointment — skip if so
        const { data: recentAppt } = await supabase
          .from('appointments')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('tenant_id', contact.tenant_id)
          .gte('created_at', contact.created_at)
          .limit(1)
          .maybeSingle()

        if (recentAppt) continue

        // Get tenant's Telnyx number for SMS
        const { data: location } = await supabase
          .from('locations')
          .select('telnyx_number')
          .eq('tenant_id', contact.tenant_id)
          .eq('is_primary', true)
          .maybeSingle()

        const telnyxNumber = location?.telnyx_number ?? ''
        const contactName = contact.full_name || 'there'
        const vars: Record<string, string> = {
          name: contactName,
          business: tenant.name || 'our business',
          phone: telnyxNumber,
        }

        let sent = false

        if (currentStep.channel === 'sms' && contact.phone && telnyxNumber) {
          const text = interpolate(currentStep.template, vars)
          sent = await sendSms(telnyxNumber, contact.phone, text)
        } else if (currentStep.channel === 'email' && contact.email) {
          const subject = currentStep.subject
            ? interpolate(currentStep.subject, vars)
            : `Following up from ${tenant.name}`
          sent = await sendTemplatedEmail({
            to: contact.email,
            subject,
            templateName: 'follow_up',
            variables: {
              contactName,
              businessName: tenant.name || '',
              message: interpolate(currentStep.template, vars),
            },
          })
        }

        if (sent) {
          console.info(
            `[follow-up-cadence] sending step ${step + 1} ${currentStep.channel} to contact=${contact.id} tenant=${contact.tenant_id}`
          )

          await supabase
            .from('contacts')
            .update({
              follow_up_step: step + 1,
              follow_up_last_sent: new Date().toISOString(),
            })
            .eq('id', contact.id)

          void publishActivityEvent({
            tenant_id: contact.tenant_id,
            event_id: contact.id,
            event_type: 'follow_up.missed',
            payload_json: {
              severity: 'low',
              contact_id: contact.id,
              contact_name: contactName,
              step: step + 1,
              channel: currentStep.channel,
              source_event_id: `follow-up-${contact.id}-step-${step + 1}`,
            },
          })

          void dispatchWebhook(contact.tenant_id, 'follow_up.sent', {
            contact_id: contact.id,
            contact_name: contactName,
            step: step + 1,
            channel: currentStep.channel,
          })

          sentCount++
        }
      } catch (err) {
        console.error(`[follow-up-cadence] error processing contact=${contact.id}:`, err)
      }
    }

    console.info(`[follow-up-cadence] scan complete: sent ${sentCount} follow-ups`)
  } catch (err) {
    console.error('[follow-up-cadence] scan error:', err)
  }
}

export function createFollowUpCadenceWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[follow-up-cadence] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
