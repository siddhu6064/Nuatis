import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { broadcastToTenant } from '../lib/conversations-ws.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'

const router = Router()

function getSupabase() {
  return createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
  )
}

// POST / — handles all Telnyx SMS webhook events
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const eventType: string = req.body?.data?.event_type ?? ''

  if (eventType === 'message.received') {
    await handleMessageReceived(req, res)
    return
  }

  if (eventType === 'message.finalized') {
    await handleMessageFinalized(req, res)
    return
  }

  // All other event types — acknowledge immediately
  res.sendStatus(200)
})

// ── message.received ──────────────────────────────────────────────────────────
async function handleMessageReceived(req: Request, res: Response): Promise<void> {
  const payload = req.body?.data?.payload ?? {}
  const fromNumber: string = payload.from?.phone_number ?? ''
  const toNumber: string = payload.to?.[0]?.phone_number ?? payload.to ?? ''
  const body: string = payload.text ?? ''
  const telnyxMessageId: string = payload.id ?? ''

  console.info(`[sms-webhook] message.received from=${fromNumber} to=${toNumber}`)

  const sb = getSupabase()

  // Dedup check
  if (telnyxMessageId) {
    const { data: existing } = await sb
      .from('sms_messages')
      .select('id')
      .eq('message_sid', telnyxMessageId)
      .maybeSingle()
    if (existing) {
      res.sendStatus(200)
      return
    }
  }

  // Find tenant by to_number
  const normalizedTo = toNumber.replace(/\D/g, '').slice(-10)
  const { data: location } = await sb
    .from('locations')
    .select('tenant_id')
    .ilike('telnyx_number', `%${normalizedTo}%`)
    .limit(1)
    .maybeSingle()

  if (!location) {
    console.warn(`[sms-webhook] no tenant found for number ${toNumber}`)
    res.sendStatus(200)
    return
  }

  const tenantId = location.tenant_id

  // Find contact by from_number
  const normalizedFrom = fromNumber.replace(/\D/g, '').slice(-10)
  let contactId: string | null = null
  let contactName: string | null = null

  const { data: matchedContact } = await sb
    .from('contacts')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .ilike('phone', `%${normalizedFrom}%`)
    .limit(1)
    .maybeSingle()

  if (matchedContact) {
    contactId = matchedContact.id
    contactName = matchedContact.full_name
  } else {
    // Create new contact
    const { data: newContact } = await sb
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        full_name: `Unknown - ${fromNumber}`,
        phone: fromNumber,
        source: 'sms',
      })
      .select('id, full_name')
      .single()
    if (newContact) {
      contactId = newContact.id
      contactName = newContact.full_name
    }
  }

  // Insert to sms_messages
  const { error: smsInsertErr } = await sb.from('sms_messages').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    direction: 'inbound',
    body,
    from_number: fromNumber,
    to_number: toNumber,
    message_sid: telnyxMessageId || null,
    status: 'received',
  })
  if (smsInsertErr) console.error('[sms-webhook] sms_messages insert failed:', smsInsertErr)

  broadcastToTenant(tenantId as string, {
    type: 'new_message',
    conversation_id: contactId ?? '',
    message: {
      id: telnyxMessageId || crypto.randomUUID(),
      direction: 'inbound',
      body,
      from_number: fromNumber,
      to_number: toNumber,
      status: 'received',
      ai_handled: false,
      created_at: new Date().toISOString(),
    },
  })

  // STOP/HELP keyword handling
  const trimmedBody = body.trim().toUpperCase()

  // TCPA opt-out — legal requirement
  if (['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(trimmedBody)) {
    if (contactId) {
      const { error: optOutErr } = await sb
        .from('contacts')
        .update({ sms_opt_in: false })
        .eq('id', contactId)
      if (optOutErr) {
        console.error(`[sms-webhook] STOP opt-out failed for contact=${contactId}:`, optOutErr)
      } else {
        console.info(`[sms-webhook] STOP received — opted out contact=${contactId}`)
      }
    }
    res.sendStatus(200)
    return
  }

  // HELP keyword
  if (trimmedBody === 'HELP') {
    const { sendSms: send } = await import('../lib/sms.js')
    const { data: loc } = await sb
      .from('locations')
      .select('telnyx_number')
      .eq('tenant_id', tenantId)
      .single()
    const fromNum = loc?.telnyx_number ?? toNumber
    void send(fromNum, fromNumber, 'Reply STOP to unsubscribe. For help call us directly.', {
      tenantId,
      contactId: contactId ?? undefined,
    })
    res.sendStatus(200)
    return
  }

  // Log activity
  if (contactId) {
    const { logActivity: logAct } = await import('../lib/activity.js')
    void logAct({
      tenantId,
      contactId,
      type: 'sms',
      body: `SMS received: "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`,
      actorType: 'contact',
    })
    enqueueScoreCompute(tenantId, contactId, 'sms_inbound')
  }

  // Push notification
  const { sendPushNotification: pushNotif } = await import('../lib/push-client.js')
  void pushNotif(tenantId, {
    title: `New SMS from ${contactName || fromNumber}`,
    body: body.slice(0, 60),
    url: contactId ? `/contacts/${contactId}?tab=messages` : '/inbox',
  })

  // Fire AI reply handler — fire-and-forget, must not block Telnyx 200
  void (async () => {
    const { handleAiSmsReply } = await import('../lib/sms-ai-reply.js')
    await handleAiSmsReply(tenantId, contactId, body, fromNumber, toNumber)
  })().catch((err) => console.error('[sms-webhook] AI reply error:', err))

  res.sendStatus(200)
}

// ── message.finalized ─────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, string> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  delivery_failed: 'failed',
  sending_failed: 'failed',
  received: 'received',
}

async function handleMessageFinalized(req: Request, res: Response): Promise<void> {
  const payload = req.body?.data?.payload ?? {}
  const messageSid: string = payload.id ?? ''
  const rawStatus: string = payload.to?.[0]?.status ?? ''
  const errors: Array<{ code?: string; title?: string }> = Array.isArray(payload.errors)
    ? payload.errors
    : []

  console.info(
    `[sms-webhook] message.finalized message_sid=${messageSid} status=${rawStatus} errors=${errors.length}`
  )

  const mappedStatus = STATUS_MAP[rawStatus]

  if (!messageSid) {
    res.sendStatus(200)
    return
  }

  const sb = getSupabase()

  // Update status if we have a valid mapping
  if (mappedStatus) {
    const { error: updateErr } = await sb
      .from('sms_messages')
      .update({ status: mappedStatus })
      .eq('message_sid', messageSid)
    if (updateErr) {
      console.error('[sms-webhook] sms_messages status update failed:', updateErr)
    }
  }

  // Insert delivery errors if any
  if (errors.length > 0) {
    // Look up tenant_id and to_number from sms_messages
    const { data: smsRow } = await sb
      .from('sms_messages')
      .select('tenant_id, to_number')
      .eq('message_sid', messageSid)
      .maybeSingle()

    let tenantId: string | null = smsRow?.tenant_id ?? null
    const toNumber: string = smsRow?.to_number ?? payload.to?.[0]?.phone_number ?? ''

    // Fallback: look up tenant by to_number if not found via sms_messages
    if (!tenantId && toNumber) {
      const normalizedTo = toNumber.replace(/\D/g, '').slice(-10)
      const { data: loc } = await sb
        .from('locations')
        .select('tenant_id')
        .ilike('telnyx_number', `%${normalizedTo}%`)
        .limit(1)
        .maybeSingle()
      tenantId = loc?.tenant_id ?? null
    }

    if (!tenantId) {
      console.warn(
        `[sms-webhook] message.finalized could not resolve tenant for message_sid=${messageSid} — skipping error insert`
      )
    } else {
      const rows = errors.map((err) => ({
        message_sid: messageSid,
        error_code: err.code ?? null,
        error_title: err.title ?? null,
        to_number: toNumber || null,
        tenant_id: tenantId,
      }))

      const { error: insertErr } = await sb.from('sms_delivery_errors').insert(rows)
      if (insertErr) {
        console.error('[sms-webhook] sms_delivery_errors insert failed:', insertErr)
      }
    }
  }

  // ── P13 campaign_sends tracking ──────────────────────────────────────────────
  if (
    rawStatus === 'delivered' ||
    rawStatus === 'delivery_failed' ||
    rawStatus === 'sending_failed'
  ) {
    const { data: smsCsRow } = await sb
      .from('sms_messages')
      .select('contact_id')
      .eq('message_sid', messageSid)
      .maybeSingle<{ contact_id: string | null }>()

    const smsContactId = smsCsRow?.contact_id ?? null
    if (smsContactId) {
      const smsCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const smsNow = new Date().toISOString()
      if (rawStatus === 'delivered') {
        await sb
          .from('campaign_sends')
          .update({ status: 'delivered', delivered_at: smsNow })
          .eq('contact_id', smsContactId)
          .eq('channel', 'sms')
          .eq('status', 'sent')
          .gte('sent_at', smsCutoff)
      } else {
        const failReason =
          errors.length > 0
            ? `${errors[0]?.code ?? ''}: ${errors[0]?.title ?? 'delivery failed'}`
            : rawStatus.replace(/_/g, ' ')
        await sb
          .from('campaign_sends')
          .update({ status: 'failed', error_msg: failReason })
          .eq('contact_id', smsContactId)
          .eq('channel', 'sms')
          .eq('status', 'sent')
          .gte('sent_at', smsCutoff)
      }
    } else {
      console.info(
        `[sms-webhook] campaign_sends update skipped — no contact_id for message_sid=${messageSid} event=${rawStatus}`
      )
    }
  }

  res.sendStatus(200)
}

export default router
