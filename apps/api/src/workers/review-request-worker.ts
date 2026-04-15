import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'
import { sendSms } from '../lib/sms.js'
import { notifyOwner } from '../lib/notifications.js'

const QUEUE_NAME = 'review-request'

const API_URL = process.env['API_URL'] || 'http://localhost:3001'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ReviewRequestJobData {
  tenantId: string
  contactId: string
  appointmentId: string
}

async function processReviewRequest(data: ReviewRequestJobData): Promise<void> {
  const { tenantId, contactId, appointmentId } = data
  const supabase = getSupabase()

  // 1. Fetch tenant settings
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('review_automation_enabled, review_message_template, booking_google_review_url, name')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    console.warn(`[review-request] tenant not found: tenant=${tenantId}`)
    return
  }

  // 2. Check if enabled and has a Google review URL
  if (!tenant.review_automation_enabled || !tenant.booking_google_review_url) {
    console.info(
      `[review-request] skipped — automation disabled or no google review url: tenant=${tenantId}`
    )
    return
  }

  // 3. Check for existing sent/clicked record for this appointment (prevent duplicates)
  const { data: existing } = await supabase
    .from('review_requests')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .in('status', ['sent', 'clicked'])
    .maybeSingle()

  if (existing) {
    console.info(`[review-request] skipped — already sent/clicked for appointment=${appointmentId}`)
    return
  }

  // 4. Fetch contact
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('first_name, last_name, phone')
    .eq('id', contactId)
    .single()

  if (contactError || !contact) {
    console.warn(`[review-request] contact not found: contact=${contactId}`)
    return
  }

  // 5. Skip if no phone
  if (!contact.phone) {
    console.info(`[review-request] skipped — no phone for contact=${contactId}`)
    return
  }

  // 6. INSERT review_request record with status='pending'
  const { data: reviewRequest, error: insertError } = await supabase
    .from('review_requests')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      appointment_id: appointmentId,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !reviewRequest) {
    console.error(`[review-request] failed to insert review_request:`, insertError)
    return
  }

  // 7. Build tracking URL
  const trackingUrl = `${API_URL}/api/review-tracking/${reviewRequest.id}`

  // 8. Resolve message template
  const defaultTemplate =
    'Hi {{first_name}}, thank you for your recent visit! We would love your feedback. Leave us a review here: {{review_url}}'
  const template = (tenant.review_message_template as string | null) ?? defaultTemplate
  const businessName = (tenant.name as string | null) ?? ''

  const resolvedMessage = template
    .replace(/\{\{first_name\}\}/g, contact.first_name ?? '')
    .replace(/\{\{last_name\}\}/g, contact.last_name ?? '')
    .replace(/\{\{business_name\}\}/g, businessName)
    .replace(/\{\{review_url\}\}/g, trackingUrl)

  // 9. Fetch telnyx_number from primary location
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  // 10. Skip if no telnyx_number
  if (!location?.telnyx_number) {
    console.warn(`[review-request] no telnyx_number for tenant=${tenantId}`)
    return
  }

  const telnyxNumber = location.telnyx_number as string

  // 11. Send SMS
  const { success } = await sendSms(telnyxNumber, contact.phone, resolvedMessage, {
    tenantId,
    contactId,
  })

  if (!success) {
    console.error(
      `[review-request] SMS failed for contact=${contactId} appointment=${appointmentId}`
    )
    return
  }

  // 12. UPDATE review_request status to 'sent'
  await supabase
    .from('review_requests')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', reviewRequest.id)

  console.info(
    `[review-request] sent review request: contact=${contactId} appointment=${appointmentId} review_request=${reviewRequest.id}`
  )

  // 13. Log activity
  await logActivity({
    tenantId,
    contactId,
    type: 'system',
    body: 'Review request SMS sent',
    metadata: { review_request_id: reviewRequest.id },
  })

  // 14. Notify owner
  await notifyOwner(tenantId, 'review_sent', {
    pushTitle: 'Review Request Sent',
    pushBody: `Review request sent to ${contact.first_name}`,
  })
}

export function createReviewRequestWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processReviewRequest(job.data as ReviewRequestJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[review-request] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
