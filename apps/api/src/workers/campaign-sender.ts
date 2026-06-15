/**
 * campaign-sender.ts — P13 AI Campaigns BullMQ worker
 *
 * Listens on queue: 'campaign-send' (shared with legacy campaign-send-worker.ts).
 * IMPORTANT: Mutual-exclusion contract with the legacy worker:
 *   - This worker (P13) processes jobs where campaign.channels is a non-empty
 *     array. If channels is null/empty, it returns early (legacy campaign).
 *   - Legacy worker (campaign-send-worker.ts) does the inverse: returns early
 *     when channels is non-empty.
 * BullMQ load-balances jobs between both workers on the shared queue, so the
 * guards must stay symmetric to avoid corruption.
 *
 * Concurrency: 1 — campaigns are large batch jobs, not high-frequency micro-jobs.
 */

import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getTenantPhoneNumber } from '../lib/telnyx-tenant-lookup.js'
import { sendSms } from '../lib/sms.js'
import { sendEmail } from '../lib/email-client.js'
import { shouldSuppressEmail } from '../lib/email-risk.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CampaignSenderJobData {
  campaignId: string
  tenantId: string
}

interface CampaignRow {
  id: string
  status: string
  objective: string | null
  channels: string[] | null
  segment_id: string | null
  contact_count: number | null
}

interface MessageRow {
  id: string
  channel: string
  subject: string | null
  body: string
  approved: boolean
}

interface ContactRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  sms_opt_in: boolean | null
  email_status: string | null
  email_risk_score: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getFirstName(fullName: string | null | undefined): string {
  if (!fullName || fullName.trim() === '') return 'there'
  return fullName.trim().split(' ')[0] ?? 'there'
}

function personalise(text: string, firstName: string, businessName: string): string {
  return text.replace(/\{first_name\}/g, firstName).replace(/\{business_name\}/g, businessName)
}

function appendUtm(url: string, campaignId: string, contactId: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}utm_source=nuatis&utm_campaign=${encodeURIComponent(campaignId)}&utm_content=${encodeURIComponent(contactId)}`
}

function tagUrlsWithUtm(text: string, campaignId: string, contactId: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (url) => appendUtm(url, campaignId, contactId))
}

function plainTextToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.trim().replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;font-size:15px;color:#333;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">${paragraphs}</body></html>`
}

// ── Core processor ────────────────────────────────────────────────────────────

async function processCampaignSend(data: CampaignSenderJobData): Promise<void> {
  const { campaignId, tenantId } = data
  const supabase = getSupabase()

  console.info(`[campaign-sender] job start: campaignId=${campaignId} tenant=${tenantId}`)

  // ── STEP 1: Load and validate campaign ────────────────────────────────────────

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, status, objective, channels, segment_id, contact_count')
    .eq('id', campaignId)
    .eq('tenant_id', tenantId)
    .single<CampaignRow>()

  if (campErr || !campaign) {
    throw new Error(`[campaign-sender] Campaign not found: ${campaignId}`)
  }

  // Guard: P13 campaigns require channels[]. Legacy campaigns (no channels) handled elsewhere.
  if (!Array.isArray(campaign.channels) || campaign.channels.length === 0) {
    console.info(
      `[campaign-sender] campaign ${campaignId} has no P13 channels — skipping (legacy campaign)`
    )
    return
  }

  if (campaign.status !== 'scheduled') {
    console.info(
      `[campaign-sender] campaign ${campaignId} status='${campaign.status}' — already ran or cancelled, skipping`
    )
    return
  }

  // ── STEP 2: Hard approval guard ────────────────────────────────────────────────

  const { data: messages, error: msgErr } = await supabase
    .from('campaign_messages')
    .select('id, channel, subject, body, approved')
    .eq('campaign_id', campaignId)

  if (msgErr) {
    throw new Error(`[campaign-sender] Failed to fetch messages: ${msgErr.message}`)
  }

  const messageRows = (messages ?? []) as MessageRow[]

  if (messageRows.length === 0) {
    throw new Error(`[campaign-sender] No messages found for campaign ${campaignId}`)
  }

  const unapproved = messageRows.filter((m) => !m.approved)
  if (unapproved.length > 0) {
    throw new Error(
      `[campaign-sender] Campaign ${campaignId} has unapproved messages — refusing to send`
    )
  }

  // Index messages by channel for fast lookup
  const messageByChannel = new Map<string, MessageRow>()
  for (const msg of messageRows) {
    messageByChannel.set(msg.channel, msg)
  }

  // ── STEP 3: Mark campaign as running ──────────────────────────────────────────

  await supabase
    .from('campaigns')
    .update({
      status: 'running',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .eq('tenant_id', tenantId)

  console.info(`[campaign-sender] campaign ${campaignId} marked running`)

  // ── STEP 4: Resolve contacts ──────────────────────────────────────────────────

  // Fetch tenant name + primary Telnyx number (once, before loop)
  const [{ data: tenantRow }, tenantPhoneNumber] = await Promise.all([
    supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle<{ name: string | null }>(),
    getTenantPhoneNumber(tenantId),
  ])

  const businessName = tenantRow?.name ?? 'Us'
  const smsFromNumber = tenantPhoneNumber ?? process.env['TELNYX_FROM_NUMBER'] ?? ''

  // Query contacts — simple fallback: all active contacts for tenant.
  // Smart-list filter execution is deferred to a future iteration.
  const { data: contactsData, error: contactsErr } = await supabase
    .from('contacts')
    .select('id, full_name, phone, email, sms_opt_in, email_status, email_risk_score')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)

  if (contactsErr) {
    throw new Error(`[campaign-sender] Failed to fetch contacts: ${contactsErr.message}`)
  }

  const contacts = (contactsData ?? []) as ContactRow[]
  console.info(
    `[campaign-sender] campaign ${campaignId}: ${contacts.length} contacts × ${campaign.channels.length} channels`
  )

  // ── STEP 5: Fan-out sends ─────────────────────────────────────────────────────

  let totalSent = 0
  let totalFailed = 0
  const now = new Date().toISOString()

  try {
    for (const contact of contacts) {
      for (const channel of campaign.channels) {
        const msg = messageByChannel.get(channel)
        if (!msg) {
          console.warn(
            `[campaign-sender] no message for channel=${channel} campaignId=${campaignId} — skipping`
          )
          continue
        }

        const firstName = getFirstName(contact.full_name)

        // ── Opt-out check ────────────────────────────────────────────────────
        if (channel === 'sms') {
          if (!contact.sms_opt_in) {
            await supabase.from('campaign_sends').insert({
              campaign_id: campaignId,
              contact_id: contact.id,
              channel,
              status: 'opted_out',
              created_at: now,
            })
            continue
          }
          if (!contact.phone || contact.phone.trim() === '') {
            console.warn(`[campaign-sender] contact ${contact.id} has no phone — skipping SMS`)
            continue
          }
        }

        if (channel === 'email') {
          if (
            shouldSuppressEmail({
              email_status: contact.email_status,
              email_risk_score: contact.email_risk_score,
            })
          ) {
            await supabase.from('campaign_sends').insert({
              campaign_id: campaignId,
              contact_id: contact.id,
              channel,
              status: 'opted_out',
              created_at: now,
            })
            continue
          }
          if (!contact.email || contact.email.trim() === '') {
            console.warn(`[campaign-sender] contact ${contact.id} has no email — skipping email`)
            continue
          }
        }

        // ── Personalise ──────────────────────────────────────────────────────
        const rawBody = personalise(msg.body, firstName, businessName)

        // ── Insert optimistic campaign_send ──────────────────────────────────
        const { data: sendRow } = await supabase
          .from('campaign_sends')
          .insert({
            campaign_id: campaignId,
            contact_id: contact.id,
            channel,
            status: 'sent',
            sent_at: now,
            created_at: now,
          })
          .select('id')
          .single<{ id: string }>()

        const sendId = sendRow?.id

        // ── Deliver ──────────────────────────────────────────────────────────
        try {
          if (channel === 'sms') {
            const result = await sendSms(smsFromNumber, contact.phone!, rawBody, {
              tenantId,
              contactId: contact.id,
            })
            if (!result.success) {
              throw new Error('sendSms returned success=false')
            }
            totalSent++
          } else if (channel === 'email') {
            const rawSubject = msg.subject
              ? personalise(msg.subject, firstName, businessName)
              : `Message from ${businessName}`

            // UTM tag URLs in body before converting to HTML
            const taggedBody = tagUrlsWithUtm(rawBody, campaignId, contact.id)
            const html = plainTextToHtml(taggedBody)

            const sent = await sendEmail({
              to: contact.email!,
              subject: rawSubject,
              html,
              tenantId,
            })
            if (!sent) {
              throw new Error('sendEmail returned false')
            }
            totalSent++
          } else if (channel === 'social') {
            console.info(
              `[campaign-sender] social send not yet implemented for contact ${contact.id} — skipping`
            )
            // Update send record to reflect social is unimplemented
            if (sendId) {
              await supabase
                .from('campaign_sends')
                .update({ status: 'failed', error_msg: 'Social channel not yet implemented' })
                .eq('id', sendId)
            }
            totalFailed++
            continue
          }
        } catch (err) {
          totalFailed++
          const errMsg = err instanceof Error ? err.message : String(err)
          console.warn(
            `[campaign-sender] send failed: campaignId=${campaignId} contactId=${contact.id} channel=${channel}: ${errMsg}`
          )
          if (sendId) {
            await supabase
              .from('campaign_sends')
              .update({ status: 'failed', error_msg: errMsg })
              .eq('id', sendId)
          }
        }
      }
    }
  } catch (err) {
    // ── Unexpected error in fan-out loop — pause for operator retry ─────────
    console.warn(
      `[campaign-sender] unexpected error in send loop for campaignId=${campaignId}: ${err instanceof Error ? err.message : String(err)}`
    )
    await supabase
      .from('campaigns')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId)
    throw err
  }

  // ── STEP 6: Mark campaign complete ────────────────────────────────────────────

  await supabase
    .from('campaigns')
    .update({ status: 'complete', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('tenant_id', tenantId)

  console.info(
    `[campaign-sender] campaign ${campaignId} complete: sent=${totalSent} failed=${totalFailed}`
  )
}

// ── Worker factory ────────────────────────────────────────────────────────────

export function createCampaignSenderWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue('campaign-send', { connection, skipVersionCheck: true })

  const worker = new Worker<CampaignSenderJobData>(
    'campaign-send',
    async (job) => {
      const data = job.data
      await processCampaignSend(data)
    },
    { connection, concurrency: 1, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    console.warn(
      `[campaign-sender] job ${job?.id ?? 'unknown'} failed: ${err instanceof Error ? err.message : String(err)}`
    )
  })

  return { queue, worker }
}
