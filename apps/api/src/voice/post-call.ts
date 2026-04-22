import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from './tool-handlers.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { sendPushNotification } from '../lib/push-client.js'

// ── Session state — written by tool handlers, read at call end ──────────────

export interface ToolCallRecord {
  name: string
  timestamp: string
}

export interface CallSessionBooking {
  bookedAppointment: boolean
  contactId: string | null
  appointmentId: string | null
  escalated?: boolean
  escalationReason?: string
  toolCalls?: ToolCallRecord[]
}

/** Keyed by callControlId. Tool handlers write here; handlePostCall reads + cleans up. */
export const callSessionState = new Map<string, CallSessionBooking>()

// ── Post-call handler ───────────────────────────────────────────────────────

export interface PostCallParams {
  tenantId: string
  callerId: string
  streamId: string
  callControlId: string
  duration: number
  vertical: string
  businessName: string
  product: 'maya_only' | 'suite'
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function handlePostCall(params: PostCallParams): Promise<void> {
  const { tenantId, callerId, streamId, callControlId, duration, vertical, businessName, product } =
    params

  // Read and clean up session state
  let booking: CallSessionBooking | undefined
  try {
    booking = callSessionState.get(callControlId)
    callSessionState.delete(callControlId)
  } catch (err) {
    console.warn('[post-call] callSessionState cleanup skipped:', err)
  }

  const bookedAppointment = booking?.bookedAppointment ?? false
  let contactId = booking?.contactId ?? null
  const appointmentId = booking?.appointmentId ?? null
  const escalated = booking?.escalated ?? false
  const escalationReason = booking?.escalationReason ?? null

  console.info(
    `[post-call] handling: tenant=${tenantId} caller=${callerId} duration=${duration}s booked=${bookedAppointment} escalated=${escalated}`
  )

  // ── Feature 1: Contact auto-upsert (Suite only) ─────────────────────────

  if (product === 'maya_only') {
    console.info('[post-call] skipping contact upsert — maya_only mode')
  } else if (!contactId && callerId) {
    try {
      const supabase = getSupabase()
      const phone = normalizePhone(callerId)
      const digitsOnly = phone.replace(/\+/, '')

      // Check if contact exists
      let { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .eq('is_archived', false)
        .limit(1)
        .maybeSingle()

      if (!existing) {
        ;({ data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('phone', digitsOnly)
          .eq('is_archived', false)
          .limit(1)
          .maybeSingle())
      }

      if (existing) {
        contactId = existing.id
        // Update last_contacted
        await supabase
          .from('contacts')
          .update({ last_contacted: new Date().toISOString() })
          .eq('id', contactId)
        console.info(`[post-call] contact found and updated: id=${contactId} phone=${callerId}`)
      } else {
        // Create minimal contact
        const { data: newContact, error } = await supabase
          .from('contacts')
          .insert({
            tenant_id: tenantId,
            full_name: callerId, // phone as placeholder name
            phone,
            source: 'inbound_call',
            notes: 'Auto-created from inbound call',
          })
          .select('id')
          .single()

        if (error) {
          console.error(`[post-call] contact insert error: ${error.message}`)
        } else {
          contactId = newContact.id
          console.info(
            `[post-call] contact created: id=${contactId} phone=${callerId} tenant=${tenantId}`
          )
          void dispatchWebhook(tenantId, 'contact.created', {
            contact_id: contactId,
            phone: callerId,
            source: 'inbound_call',
          })
          void sendPushNotification(tenantId, {
            title: 'New Lead',
            body: `New contact from inbound call: ${callerId}`,
            url: '/contacts',
          })
        }
      }
    } catch (err) {
      console.error('[post-call] contact upsert error:', err)
    }
  } else if (contactId) {
    console.info(`[post-call] contact already upserted during call: id=${contactId}`)
  }

  // ── Feature 2: SMS confirmation after booking ───────────────────────────

  if (bookedAppointment && appointmentId && callerId) {
    try {
      const supabase = getSupabase()

      // Get appointment details
      const { data: appt } = await supabase
        .from('appointments')
        .select('title, start_time')
        .eq('id', appointmentId)
        .single()

      // Get tenant's Telnyx phone number
      const { data: location } = await supabase
        .from('locations')
        .select('telnyx_number')
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
        .maybeSingle()

      const fromNumber = location?.telnyx_number
      const apiKey = process.env['TELNYX_API_KEY']

      if (appt && fromNumber && apiKey) {
        const startDate = new Date(appt.start_time)
        const formatted = startDate.toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })

        const smsText = `Your appointment '${appt.title}' is confirmed for ${formatted}. Reply CANCEL to cancel. - ${businessName}`

        const res = await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromNumber,
            to: callerId,
            text: smsText,
          }),
        })

        if (res.ok) {
          console.info(
            `[post-call] SMS confirmation sent to=${callerId} appointment=${appointmentId}`
          )
        } else {
          const body = await res.text()
          console.error(`[post-call] SMS confirmation failed (${res.status}): ${body}`)
        }
      } else {
        if (!appt) console.warn('[post-call] SMS skipped — appointment not found')
        if (!fromNumber) console.warn('[post-call] SMS skipped — no Telnyx number for tenant')
        if (!apiKey) console.warn('[post-call] SMS skipped — TELNYX_API_KEY not set')
      }
    } catch (err) {
      console.error('[post-call] SMS confirmation error:', err)
    }
  }

  // ── Feature 2b: Auto-generate draft quote from call ─────────────────────

  if (product !== 'maya_only' && contactId && bookedAppointment && booking?.toolCalls) {
    try {
      const bookCall = booking.toolCalls.find((tc) => tc.name === 'book_appointment')
      if (bookCall) {
        void generateAutoQuote(tenantId, contactId, vertical).catch((err) =>
          console.error('[post-call] auto-quote error:', err)
        )
      }
    } catch {
      // best-effort
    }
  }

  // ── Feature 3: Ops-Copilot webhook ──────────────────────────────────────

  try {
    void publishActivityEvent({
      tenant_id: tenantId,
      event_id: streamId || callControlId || 'unknown',
      event_type: 'call.completed',
      payload_json: {
        caller_phone: callerId,
        duration_seconds: duration,
        booked_appointment: bookedAppointment,
        appointment_id: appointmentId,
        contact_id: contactId,
        escalated,
        escalation_reason: escalationReason,
        vertical,
        timestamp: new Date().toISOString(),
      },
    })
    console.info(
      `[post-call] ops-copilot webhook enqueued: event=call.completed tenant=${tenantId} booked=${bookedAppointment}`
    )
  } catch (err) {
    console.error('[post-call] ops-copilot webhook error:', err)
  }

  // ── Feature 4: Tenant webhook dispatch (Suite only) ─────────────────────

  if (product !== 'maya_only')
    void dispatchWebhook(tenantId, 'call.completed', {
      caller_phone: callerId,
      duration_seconds: duration,
      booked_appointment: bookedAppointment,
      appointment_id: appointmentId,
      contact_id: contactId,
      escalated,
      vertical,
    })

  // Push notification for notable outcomes
  if (bookedAppointment) {
    void sendPushNotification(tenantId, {
      title: 'New Booking',
      body: `${callerId} booked an appointment via Maya`,
      url: '/calls',
    })
  } else if (escalated) {
    void sendPushNotification(tenantId, {
      title: 'Call Escalated',
      body: `${callerId} was escalated: ${escalationReason ?? 'requested human'}`,
      url: '/calls',
    })
  }
}

// ── Auto-quote generation ────────────────────────────────────────────────────

export async function generateAutoQuote(
  tenantId: string,
  contactId: string,
  _vertical: string
): Promise<void> {
  const supabase = getSupabase()

  // Find the first active service for this tenant as a default line item
  const { data: services } = await supabase
    .from('services')
    .select('id, name, unit_price')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(3)

  if (!services || services.length === 0) return

  const { randomUUID } = await import('crypto')
  const { nextQuoteNumber } = await import('../routes/quotes.js')

  const quoteNumber = await nextQuoteNumber(supabase, tenantId)
  const firstService = services[0]!

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId,
      contact_id: contactId,
      quote_number: quoteNumber,
      title: `${firstService.name}`,
      status: 'draft',
      subtotal: firstService.unit_price,
      tax_rate: 0,
      tax_amount: 0,
      total: firstService.unit_price,
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      share_token: randomUUID(),
      created_by: 'ai',
    })
    .select('id')
    .single()

  if (error || !quote) return

  await supabase.from('quote_line_items').insert({
    quote_id: quote.id,
    service_id: firstService.id,
    description: firstService.name,
    quantity: 1,
    unit_price: firstService.unit_price,
    total: firstService.unit_price,
    sort_order: 0,
  })

  console.info(`[post-call] auto-generated draft quote ${quoteNumber} for contact=${contactId}`)
}
