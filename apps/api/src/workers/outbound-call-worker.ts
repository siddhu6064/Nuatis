import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { isScannerPaused } from '../lib/scanner-pause.js'
import { initiateOutboundCall } from '../lib/outbound-caller.js'

export interface OutboundCallJobData {
  jobId: string
}

interface OutboundCallJob {
  id: string
  tenant_id: string
  contact_id: string
  trigger_type: string
  trigger_config: { call_context?: string } | null
  status: string
  max_attempts: number
  attempts: number
}

interface ContactRow {
  id: string
  full_name: string | null
  phone: string | null
  sms_opt_in: boolean | null
  is_archived: boolean | null
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function processOutboundCall(data: OutboundCallJobData): Promise<void> {
  const { jobId } = data
  console.info(`[outbound-call] picked up job=${jobId}`)
  const supabase = getSupabase()

  // Step 1: Fetch the job row
  const { data: job, error: jobErr } = await supabase
    .from('outbound_call_jobs')
    .select(
      'id, tenant_id, contact_id, trigger_type, trigger_config, status, max_attempts, attempts'
    )
    .eq('id', jobId)
    .single()

  console.info(
    `[outbound-call] job DB query done: jobId=${jobId} hasRow=${!!job} hasErr=${!!jobErr} errMsg=${jobErr?.message ?? 'none'}`
  )

  if (jobErr || !job) {
    console.warn(
      `[outbound-call] job not found: jobId=${jobId} supabaseError=${jobErr?.message ?? 'no row'}`
    )
    return
  }

  const typedJob = job as unknown as OutboundCallJob
  console.info(
    `[outbound-call] job record: job=${jobId} status=${typedJob.status} tenant=${typedJob.tenant_id} contact=${typedJob.contact_id}`
  )

  // Step 2: Check status still pending
  if (typedJob.status !== 'pending') {
    console.info(`[outbound-call] job ${jobId} status=${typedJob.status} — skipping`)
    return
  }

  const tenantId = typedJob.tenant_id
  const contactId = typedJob.contact_id
  const callContext = typedJob.trigger_config?.call_context ?? 'follow-up call'

  // Step 3: Check scanner paused
  const paused = await isScannerPaused(tenantId, 'outbound-calls')
  if (paused) {
    console.info(`[outbound-call] scanner paused for tenant=${tenantId} — skipping`)
    return
  }

  // Step 4: Fetch contact
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id, full_name, phone, sms_opt_in, is_archived')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  console.info(
    `[outbound-call] contact query done: contactId=${contactId} hasRow=${!!contact} hasErr=${!!contactErr} errMsg=${contactErr?.message ?? 'none'} errCode=${contactErr?.code ?? 'none'}`
  )

  if (contactErr || !contact) {
    console.warn(
      `[outbound-call] contact not found: contactId=${contactId} job=${jobId} supabaseError=${contactErr?.message ?? 'no row'}`
    )
    await supabase
      .from('outbound_call_jobs')
      .update({ status: 'failed', error_message: contactErr?.message ?? 'Contact not found' })
      .eq('id', jobId)
    return
  }

  const typedContact = contact as unknown as ContactRow
  const phone = typedContact.phone
  const optedIn = typedContact.sms_opt_in
  const archived = typedContact.is_archived

  // Step 5: Validate phone exists and contact opted in
  if (!phone) {
    await supabase
      .from('outbound_call_jobs')
      .update({ status: 'failed', error_message: 'Contact has no phone number' })
      .eq('id', jobId)
    console.warn(`[outbound-call] contact ${contactId} has no phone — job ${jobId} failed`)
    return
  }

  if (optedIn !== true || archived) {
    await supabase
      .from('outbound_call_jobs')
      .update({
        status: 'cancelled',
        error_message: optedIn !== true ? 'Contact not opted in to calls' : 'Contact archived',
      })
      .eq('id', jobId)
    console.info(
      `[outbound-call] contact ${contactId} optedIn=${optedIn} archived=${archived} — job ${jobId} cancelled`
    )
    return
  }

  // Step 6: Fetch fromNumber (tenant's primary telnyx_number)
  const { data: telnyxNum, error: telnyxNumErr } = await supabase
    .from('telnyx_numbers')
    .select('phone_number')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  const fromNumber = (telnyxNum as { phone_number: string | null } | null)?.phone_number ?? null

  if (telnyxNumErr || !fromNumber) {
    await supabase
      .from('outbound_call_jobs')
      .update({
        status: 'failed',
        error_message: telnyxNumErr?.message ?? 'No Telnyx number configured',
      })
      .eq('id', jobId)
    console.warn(
      `[outbound-call] no telnyx_number for tenant=${tenantId} — job ${jobId} failed errMsg=${telnyxNumErr?.message ?? 'no row'}`
    )
    return
  }

  // Step 7: Initiate the call
  console.info(`[outbound-call] initiating call: job=${jobId} tenant=${tenantId}`)
  try {
    const result = await initiateOutboundCall({
      tenantId,
      contactId,
      jobId,
      toNumber: phone,
      fromNumber,
      callContext,
    })
    console.info(
      `[outbound-call] initiated: job=${jobId} callControlId=${result.callControlId} callLegId=${result.callLegId}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await supabase
      .from('outbound_call_jobs')
      .update({ status: 'failed', error_message: msg })
      .eq('id', jobId)
    console.error(`[outbound-call] failed to initiate: job=${jobId} error=${msg}`, err)
    throw err
  }
}

export function createOutboundCallWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()
  const queue = new Queue('outbound-calls', { connection, skipVersionCheck: true })
  const worker = new Worker(
    'outbound-calls',
    async (job) => {
      await processOutboundCall(job.data as OutboundCallJobData)
    },
    { connection, skipVersionCheck: true }
  )
  worker.on('failed', (job, err) => {
    console.error(`[outbound-call] job ${job?.id} failed:`, err)
  })
  return { queue, worker }
}
