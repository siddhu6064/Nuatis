import { createClient } from '@supabase/supabase-js'
import { checkTcpaOptIn } from './tcpa.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface SendSmsOptions {
  tenantId?: string
  contactId?: string
}

/**
 * Send an SMS via Telnyx and log to sms_messages table.
 * Backward-compatible: existing callers that don't pass options still work.
 */
export async function sendSms(
  from: string,
  to: string,
  text: string,
  options?: SendSmsOptions
): Promise<{ success: boolean; messageId?: string }> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) {
    console.error('[sms] TELNYX_API_KEY not configured — cannot send SMS')
    return { success: false }
  }

  try {
    if (options?.contactId && options?.tenantId) {
      const allowed = await checkTcpaOptIn(options.contactId, options.tenantId)
      if (!allowed) {
        console.warn(
          `[sendSms] TCPA suppressed: contact=${options.contactId} tenant=${options.tenantId} to=${to}`
        )
        return { success: false }
      }
    }

    const body: Record<string, string> = { from, to, text }
    if (process.env['TELNYX_MESSAGING_PROFILE_ID']) {
      body['messaging_profile_id'] = process.env['TELNYX_MESSAGING_PROFILE_ID']
    }

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[sms] send failed (${res.status}): ${body}`)
      return { success: false }
    }

    const data = (await res.json()) as { data?: { id?: string } }
    const messageId = data?.data?.id ?? undefined

    // Log outbound SMS to sms_messages for thread view
    if (options?.tenantId) {
      try {
        const supabase = getSupabase()
        const { error: smsErr } = await supabase.from('sms_messages').insert({
          tenant_id: options.tenantId,
          contact_id: options.contactId ?? null,
          direction: 'outbound',
          body: text,
          from_number: from,
          to_number: to,
          message_sid: messageId ?? null,
          status: 'sent',
          ai_handled: false,
        })
        if (smsErr) console.error('[sms] failed to log to sms_messages:', smsErr)
      } catch (err) {
        console.error('[sms] failed to log outbound SMS:', err)
      }
    }

    return { success: true, messageId }
  } catch (err) {
    console.error('[sms] send error:', err)
    return { success: false }
  }
}
