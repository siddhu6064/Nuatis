import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { sendSms } from '../lib/sms.js'
import { sendTemplatedEmail } from '../lib/email-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { logActivity } from '../lib/activity.js'
import { getPausedTenants } from '../lib/scanner-pause.js'
import { getTenantPhoneNumber } from '../lib/telnyx-tenant-lookup.js'

// Tenant-editable counterpart to follow-up-cadence-worker.ts's hardcoded
// per-vertical cadence — same step shape (days_after/channel/subject/
// template) and the same interpolate/send logic, but driven by
// outreach_sequence_enrollments instead of every new contact automatically.
const QUEUE_NAME = 'outreach-sequence-scanner'

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
}

interface EnrollmentRow {
  id: string
  tenant_id: string
  sequence_id: string
  contact_id: string
  current_step: number
  last_sent_at: string | null
  enrolled_at: string
}

interface StepRow {
  id: string
  sequence_id: string
  step_order: number
  days_after: number
  channel: 'sms' | 'email'
  subject: string | null
  template: string
}

interface ContactRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
}

export async function scan(): Promise<void> {
  console.info('[outreach-sequence-scanner] scanning enrollments due for their next step...')

  try {
    const supabase = getServiceClient()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)

    const { data: enrollments, error } = await supabase
      .from('outreach_sequence_enrollments')
      .select('id, tenant_id, sequence_id, contact_id, current_step, last_sent_at, enrolled_at')
      .eq('status', 'active')

    if (error) {
      console.error(`[outreach-sequence-scanner] enrollments query error: ${error.message}`)
      return
    }

    if (!enrollments || enrollments.length === 0) {
      console.info('[outreach-sequence-scanner] no active enrollments')
      return
    }

    let sentCount = 0
    const now = Date.now()

    for (const enrollment of enrollments as EnrollmentRow[]) {
      if (pausedTenants.has(enrollment.tenant_id)) continue
      try {
        const [{ data: sequence }, { data: steps }, { data: contact }] = await Promise.all([
          supabase
            .from('outreach_sequences')
            .select('id, name, enabled')
            .eq('id', enrollment.sequence_id)
            .maybeSingle(),
          supabase
            .from('outreach_sequence_steps')
            .select('id, sequence_id, step_order, days_after, channel, subject, template')
            .eq('sequence_id', enrollment.sequence_id)
            .order('step_order', { ascending: true }),
          supabase
            .from('contacts')
            .select('id, full_name, phone, email')
            .eq('id', enrollment.contact_id)
            .maybeSingle(),
        ])

        if (!sequence || !sequence.enabled || !contact) continue

        const stepList = (steps ?? []) as StepRow[]
        if (enrollment.current_step >= stepList.length) {
          await supabase
            .from('outreach_sequence_enrollments')
            .update({ status: 'completed' })
            .eq('id', enrollment.id)
          continue
        }

        const step = stepList[enrollment.current_step]!
        const referenceDate = enrollment.last_sent_at
          ? new Date(enrollment.last_sent_at).getTime()
          : new Date(enrollment.enrolled_at).getTime()
        const daysSinceRef = (now - referenceDate) / 86400000
        if (daysSinceRef < step.days_after) continue

        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', enrollment.tenant_id)
          .maybeSingle()

        const c = contact as ContactRow
        const contactName = c.full_name || 'there'
        const telnyxNumber = (await getTenantPhoneNumber(enrollment.tenant_id)) ?? ''
        const vars: Record<string, string> = {
          name: contactName,
          business: tenant?.name || 'our business',
          phone: telnyxNumber,
        }

        let sent = false

        if (step.channel === 'sms' && c.phone && telnyxNumber) {
          const text = interpolate(step.template, vars)
          const { success } = await sendSms(telnyxNumber, c.phone, text, {
            contactId: c.id,
            tenantId: enrollment.tenant_id,
          })
          sent = success
        } else if (step.channel === 'email' && c.email) {
          const subject = step.subject
            ? interpolate(step.subject, vars)
            : `A message from ${tenant?.name ?? 'us'}`
          sent = await sendTemplatedEmail({
            to: c.email,
            subject,
            templateName: 'follow_up',
            variables: {
              contactName,
              businessName: tenant?.name || '',
              message: interpolate(step.template, vars),
            },
          })
        }

        if (!sent) continue

        console.info(
          `[outreach-sequence-scanner] sent step ${enrollment.current_step + 1}/${stepList.length} (${step.channel}) contact=${c.id} sequence=${sequence.id}`
        )

        const nextStep = enrollment.current_step + 1
        await supabase
          .from('outreach_sequence_enrollments')
          .update({
            current_step: nextStep,
            last_sent_at: new Date().toISOString(),
            status: nextStep >= stepList.length ? 'completed' : 'active',
          })
          .eq('id', enrollment.id)

        void logActivity({
          tenantId: enrollment.tenant_id,
          contactId: c.id,
          type: step.channel === 'sms' ? 'sms' : 'email',
          body: interpolate(step.template, vars),
          metadata: {
            sequence_id: sequence.id,
            sequence_name: sequence.name,
            step: nextStep,
            channel: step.channel,
            automated: true,
          },
          actorType: 'ai',
        })

        void dispatchWebhook(enrollment.tenant_id, 'outreach_sequence.step_sent', {
          contact_id: c.id,
          contact_name: contactName,
          sequence_id: sequence.id,
          step: nextStep,
          channel: step.channel,
        })

        sentCount++
      } catch (err) {
        console.error(
          `[outreach-sequence-scanner] error processing enrollment=${enrollment.id}:`,
          err
        )
      }
    }

    console.info(`[outreach-sequence-scanner] scan complete: sent ${sentCount} step(s)`)
  } catch (err) {
    console.error('[outreach-sequence-scanner] scan error:', err)
  }
}

export function createOutreachSequenceWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[outreach-sequence-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
