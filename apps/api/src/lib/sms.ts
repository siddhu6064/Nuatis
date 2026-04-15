import { createClient } from '@supabase/supabase-js'

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
 * Send an SMS via Telnyx and optionally log to inbound_sms table.
 * Backward-compatible: existing callers that don't pass options still work.
 */
export async function sendSms(
  from: string,
  to: string,
  text: string,
  options?: SendSmsOptions
): Promise<{ success: boolean; messageId?: string }> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) return { success: false }

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
      console.error(`[sms] send failed (${res.status}): ${body}`)
      return { success: false }
    }

    const data = (await res.json()) as { data?: { id?: string } }
    const messageId = data?.data?.id ?? undefined

    // Log outbound SMS to inbound_sms table for thread view
    if (options?.tenantId) {
      try {
        const supabase = getSupabase()
        await supabase.from('inbound_sms').insert({
          tenant_id: options.tenantId,
          contact_id: options.contactId ?? null,
          from_number: from,
          to_number: to,
          body: text,
          direction: 'outbound',
          telnyx_message_id: messageId ?? null,
          status: 'read',
          read_at: new Date().toISOString(),
        })
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
