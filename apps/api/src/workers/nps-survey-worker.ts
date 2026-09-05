import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { getFirstName } from '@nuatis/shared'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'
import { sendSms } from '../lib/sms.js'
import { buildNpsSurveySms } from '../lib/sms-templates.js'
import { notifyOwner } from '../lib/notifications.js'
import { isScannerPaused } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'nps-survey'

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3000'

interface NpsSurveyJobData {
  tenantId: string
  contactId: string
  appointmentId: string
}

export async function processNpsSurvey(data: NpsSurveyJobData): Promise<void> {
  const { tenantId, contactId, appointmentId } = data
  const supabase = getServiceClient()

  // 1. Fetch tenant settings
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('nps_survey_automation_enabled, name')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    console.warn(`[nps-survey] tenant not found: tenant=${tenantId}`)
    return
  }

  // 2. Check if enabled
  if (!tenant.nps_survey_automation_enabled) {
    console.info(`[nps-survey] skipped — automation disabled: tenant=${tenantId}`)
    return
  }

  // 3. Check for existing sent/responded record for this appointment (prevent duplicates)
  const { data: existing } = await supabase
    .from('nps_responses')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .in('status', ['sent', 'responded'])
    .maybeSingle()

  if (existing) {
    console.info(`[nps-survey] skipped — already sent/responded for appointment=${appointmentId}`)
    return
  }

  // 4. Fetch contact
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('full_name, phone')
    .eq('id', contactId)
    .single()

  if (contactError || !contact) {
    console.warn(`[nps-survey] contact not found: contact=${contactId}`)
    return
  }

  // 5. Skip if no phone
  if (!contact.phone) {
    console.info(`[nps-survey] skipped — no phone for contact=${contactId}`)
    return
  }

  // 6. INSERT nps_responses record with status='pending'
  const { data: npsResponse, error: insertError } = await supabase
    .from('nps_responses')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      appointment_id: appointmentId,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !npsResponse) {
    console.error(`[nps-survey] failed to insert nps_responses:`, insertError)
    return
  }

  // 7. Build survey URL (frontend capture page, not an API redirect)
  const surveyUrl = `${WEB_URL}/nps/view/${npsResponse.id}`

  // 8. Resolve message
  const businessName = (tenant.name as string | null) ?? ''
  const firstName = getFirstName(contact.full_name, '')
  const smsBody = buildNpsSurveySms({
    contactName: firstName || null,
    businessName,
    surveyUrl,
  })

  // 9. Fetch telnyx_number from primary location
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  // 10. Skip if no telnyx_number
  if (!location?.telnyx_number) {
    console.warn(`[nps-survey] no telnyx_number for tenant=${tenantId}`)
    return
  }

  const telnyxNumber = location.telnyx_number as string

  // 11. Send SMS
  const { success } = await sendSms(telnyxNumber, contact.phone, smsBody, {
    tenantId,
    contactId,
  })

  if (!success) {
    console.error(`[nps-survey] SMS failed for contact=${contactId} appointment=${appointmentId}`)
    return
  }

  // 12. UPDATE nps_responses status to 'sent'
  await supabase
    .from('nps_responses')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', npsResponse.id)

  console.info(
    `[nps-survey] sent survey: contact=${contactId} appointment=${appointmentId} nps_response=${npsResponse.id}`
  )

  // 13. Log activity
  await logActivity({
    tenantId,
    contactId,
    type: 'sms',
    body: smsBody,
    metadata: { nps_response_id: npsResponse.id, automated: true, trigger: 'nps_survey' },
    actorType: 'ai',
  })

  // 14. Notify owner
  await notifyOwner(tenantId, 'nps_survey_sent', {
    pushTitle: 'NPS Survey Sent',
    pushBody: `NPS survey sent to ${firstName}`,
  })
}

export function createNpsSurveyWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const jobData = job.data as { tenantId: string }
      if (await isScannerPaused(jobData.tenantId, QUEUE_NAME)) {
        console.info(`[nps-survey] paused for tenant=${jobData.tenantId} — skipping`)
        return
      }
      await processNpsSurvey(job.data as NpsSurveyJobData)
    },
    { connection, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    console.error(`[nps-survey] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
