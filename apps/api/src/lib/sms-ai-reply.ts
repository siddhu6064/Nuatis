import { createClient } from '@supabase/supabase-js'
import { sendSms } from './sms.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function handleAiSmsReply(
  tenantId: string,
  contactId: string | null,
  messageBody: string,
  fromNumber: string, // customer's number (reply-to)
  toNumber: string // our number (from)
): Promise<void> {
  try {
    const supabase = getSupabase()

    // a. Load context from Supabase

    // Contact lookup (skip if contactId is null)
    let contactName: string | null = null
    if (contactId) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('full_name')
        .eq('id', contactId)
        .single()
      if (contact) {
        contactName = (contact as { full_name?: string | null }).full_name ?? null
      }
    }

    // Conversation history: last 10 messages for this contact
    let historyQuery = supabase
      .from('sms_messages')
      .select('direction, body, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (contactId) {
      historyQuery = historyQuery.eq('contact_id', contactId)
    } else {
      // Unknown contact — scope to this phone number conversation
      historyQuery = historyQuery.eq('from_number', fromNumber)
    }

    // Parallelize independent queries
    const [{ data: historyRows }, { data: location }, { data: tenant }] = await Promise.all([
      historyQuery,
      supabase
        .from('locations')
        .select('business_profile, vertical, telnyx_number')
        .eq('tenant_id', tenantId)
        .single(),
      supabase.from('tenants').select('name').eq('id', tenantId).single(),
    ])

    const businessName = (tenant as { name?: string | null } | null)?.name ?? 'our team'
    const vertical = (location as { vertical?: string | null } | null)?.vertical ?? 'business'
    const businessProfile =
      (location as { business_profile?: unknown } | null)?.business_profile ?? null

    // b. Build Gemini prompt

    const profileText = businessProfile
      ? `\nBusiness context: ${JSON.stringify(businessProfile)}`
      : ''

    const systemPrompt =
      `You are a helpful AI assistant for ${businessName}, a ${vertical} business.\n` +
      `You are responding to an SMS from a customer named ${contactName ?? 'Unknown'}.\n` +
      `Keep replies SHORT (1-3 sentences max).\n` +
      `You can: answer questions about services/hours, confirm/cancel appointments, qualify leads by asking what service they need.\n` +
      `You cannot: make payments, access external systems, make promises not in the business profile.\n` +
      `If the customer wants to speak to a human, reply: "I'll have someone from our team reach out to you shortly."\n` +
      `Always end with: — ${businessName} team` +
      profileText

    // Format last 5 messages (most-recent last) as conversation history
    const last5 = ((historyRows ?? []) as Array<{ direction: string; body: string }>)
      .slice(0, 5)
      .reverse()

    const historyText = last5
      .map((msg) => {
        const speaker = msg.direction === 'inbound' ? 'Customer' : 'Us'
        return `${speaker}: ${msg.body}`
      })
      .join('\n')

    const userTurn = `Customer just replied: "${messageBody}". What should we reply?`

    // Check API key before calling Gemini
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      console.warn('[sms-ai] GEMINI_API_KEY not set — skipping AI SMS reply')
      return
    }

    // c. Call Gemini
    const { GoogleGenAI } = await import('@google/genai')
    const genai = new GoogleGenAI({ apiKey })

    const fullPrompt = systemPrompt + '\n\n' + historyText + '\n\n' + userTurn

    const result = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      config: { maxOutputTokens: 150 },
    })

    const aiResponse = result?.text ?? ''

    if (!aiResponse) {
      console.warn('[sms-ai] Gemini returned empty response — skipping send')
      return
    }

    // d. Send reply via sendSms (toNumber = our number, fromNumber = customer's number)
    await sendSms(toNumber, fromNumber, aiResponse, {
      tenantId,
      contactId: contactId ?? undefined,
    })

    // e. Log outbound to sms_messages
    const { error: insertErr } = await supabase.from('sms_messages').insert({
      tenant_id: tenantId,
      contact_id: contactId,
      direction: 'outbound',
      body: aiResponse,
      from_number: toNumber, // our number
      to_number: fromNumber, // customer's number
      status: 'sent',
      ai_handled: true,
      ai_response: aiResponse,
    })
    if (insertErr) console.error('[sms-ai] failed to log outbound', insertErr)
  } catch (err) {
    // f. On any error: log and return — do NOT send a broken message
    console.error('[sms-ai]', err)
  }
}
