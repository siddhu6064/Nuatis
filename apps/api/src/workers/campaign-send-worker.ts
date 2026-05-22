/**
 * campaign-send-worker.ts — Legacy email-only campaign BullMQ worker.
 *
 * Listens on queue: 'campaign-send' (shared with P13 campaign-sender.ts).
 * IMPORTANT: This worker guards on campaign.channels — if channels is a
 * non-empty array the campaign is a P13 multi-channel campaign and is handled
 * by campaign-sender.ts. We return early to keep the two workers mutually
 * exclusive on the shared queue. The inverse guard lives in campaign-sender.ts.
 */

import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { shouldSuppressEmail } from '../lib/email-risk.js'

export interface CampaignSendJobData {
  campaignId: string
  tenantId: string
}

interface ContactRow {
  id: string
  full_name: string | null
  email: string
  email_status: string | null
  email_risk_score: number | null
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export async function processCampaignSend(data: CampaignSendJobData): Promise<void> {
  const { campaignId, tenantId } = data
  const supabase = getSupabase()

  try {
    // Step 1: Fetch campaign from DB. If not found or cancelled, return early.
    const { data: campaign, error: campaignErr } = await supabase
      .from('campaigns')
      .select('id, status, subject, body_html, smart_list_id, channels')
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)
      .single()

    if (campaignErr || !campaign) {
      console.warn(`[campaign-send] campaign not found: id=${campaignId}`)
      return
    }

    // Inverse of campaign-sender.ts guard: P13 multi-channel campaigns have
    // channels[] populated and are handled by that worker. Skip here so the two
    // workers stay mutually exclusive on the shared 'campaign-send' queue.
    const campaignChannels = (campaign as { channels?: string[] | null }).channels
    if (Array.isArray(campaignChannels) && campaignChannels.length > 0) {
      console.info(
        `[campaign-send] campaign ${campaignId} has P13 channels — skipping (handled by campaign-sender)`
      )
      return
    }

    if ((campaign as { status: string }).status === 'cancelled') {
      console.info(`[campaign-send] campaign cancelled, skipping: id=${campaignId}`)
      return
    }

    // Step 2: UPDATE campaign SET status = 'sending'
    await supabase
      .from('campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)

    // Step 3: Fetch tenant (name, brand_voice)
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, brand_voice')
      .eq('id', tenantId)
      .single()

    void tenant // fetched for context; brand_voice may be used in future personalization

    // Step 4: Fetch smart_list details (name, filters)
    const smartListId = (campaign as { smart_list_id?: string | null }).smart_list_id
    if (smartListId) {
      await supabase
        .from('smart_lists')
        .select('id, name, filters')
        .eq('id', smartListId)
        .eq('tenant_id', tenantId)
        .single()
    }

    // Step 5: Get eligible contacts
    const { data: rawContacts } = await supabase
      .from('contacts')
      .select('id, full_name, email, email_status, email_risk_score')
      .eq('tenant_id', tenantId)
      .not('email', 'is', null)
      .eq('is_archived', false)
      .not('email_status', 'in', '("hard_bounce","complained","unsubscribed")')

    const contacts: ContactRow[] = (rawContacts ?? []) as ContactRow[]

    // Step 6 & 7: Apply shouldSuppressEmail check and filter
    const filteredContacts = contacts.filter((c) => !shouldSuppressEmail(c))

    // Step 8: UPDATE campaign SET recipient_count = filteredContacts.length
    await supabase
      .from('campaigns')
      .update({ recipient_count: filteredContacts.length })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)

    // Step 9: Batch INSERT campaign_recipients
    const recipientRows = filteredContacts.map((c) => ({
      campaign_id: campaignId,
      tenant_id: tenantId,
      contact_id: c.id,
      email: c.email,
      status: 'pending',
    }))

    for (const chunk of chunks(recipientRows, 100)) {
      await supabase
        .from('campaign_recipients')
        .upsert(chunk, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
    }

    // Step 10: Fetch inserted recipients with pending status
    const { data: recipients } = await supabase
      .from('campaign_recipients')
      .select('id, contact_id, email')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')

    const pendingRecipients = (recipients ?? []) as Array<{
      id: string
      contact_id: string
      email: string
    }>

    // Build contact lookup map for full_name
    const contactMap = new Map<string, ContactRow>()
    for (const c of filteredContacts) {
      contactMap.set(c.id, c)
    }

    const campaignData = campaign as {
      subject: string
      body_html: string
      status: string
      smart_list_id?: string | null
    }

    // Step 11: Send in batches of 50, 100ms delay between batches
    const sendBatches = chunks(pendingRecipients, 50)

    for (let batchIdx = 0; batchIdx < sendBatches.length; batchIdx++) {
      if (batchIdx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const batch = sendBatches[batchIdx]!

      for (const recipient of batch) {
        // a. Get contact full_name
        const contact = contactMap.get(recipient.contact_id)
        const contactName = contact?.full_name ?? 'Friend'

        // b. Build personalized HTML
        const personalizedHtml = (campaignData.body_html ?? '').replace(
          /\{\{contact_name\}\}/g,
          contactName
        )

        // c. Call Resend API
        const resendApiKey = process.env['RESEND_API_KEY']
        if (!resendApiKey) {
          await supabase
            .from('campaign_recipients')
            .update({ status: 'failed', error_message: 'RESEND_API_KEY not configured' })
            .eq('id', recipient.id)
          continue
        }

        try {
          const { Resend } = await import('resend')
          const resend = new Resend(resendApiKey)

          const { data: emailData, error } = await resend.emails.send({
            from: process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>',
            to: recipient.email,
            subject: campaignData.subject,
            html: personalizedHtml,
            tags: [
              { name: 'tenant_id', value: tenantId },
              { name: 'campaign_id', value: campaignId },
              { name: 'campaign_recipient_id', value: recipient.id },
            ],
          })

          // d. If success
          if (!error && emailData) {
            await supabase
              .from('campaign_recipients')
              .update({
                status: 'sent',
                resend_email_id: emailData.id,
                sent_at: new Date().toISOString(),
              })
              .eq('id', recipient.id)
          } else {
            // e. If error
            await supabase
              .from('campaign_recipients')
              .update({
                status: 'failed',
                error_message: error?.message ?? 'Unknown Resend error',
              })
              .eq('id', recipient.id)
          }
        } catch (sendErr) {
          const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
          await supabase
            .from('campaign_recipients')
            .update({ status: 'failed', error_message: errMsg })
            .eq('id', recipient.id)
        }
      }
    }

    // Step 12: Count actual sent
    const { count: sentCount } = await supabase
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'sent')

    const actualSentCount = sentCount ?? 0

    // Step 13: UPDATE campaign SET status='sent', sent_at=now(), sent_count=actualSentCount
    await supabase
      .from('campaigns')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: actualSentCount,
      })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)

    console.info(
      `[campaign-send] done campaignId=${campaignId} sent=${actualSentCount}/${pendingRecipients.length}`
    )
  } catch (err) {
    // Revert status to 'draft' so it can be retried
    await supabase
      .from('campaigns')
      .update({ status: 'draft' })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)
    throw err
  }
}

export function createCampaignSendWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue('campaign-send', { connection, skipVersionCheck: true })
  const worker = new Worker(
    'campaign-send',
    async (job) => {
      await processCampaignSend(job.data as CampaignSendJobData)
    },
    { connection, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    console.error(`[campaign-send] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
