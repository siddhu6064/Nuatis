import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from './tool-handlers.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { sendPushNotification } from '../lib/push-client.js'
import { sendSms } from '../lib/sms.js'
import { grantTcpaOptIn } from '../lib/tcpa.js'
import { buildConfirmationSms } from '../lib/sms-templates.js'
import { sendEmail } from '../lib/email-client.js'
import {
  sendViaGmail,
  sendViaOutlook,
  buildMimeMessage,
  injectTrackingPixel,
} from '../lib/email-send.js'
import { getValidToken } from '../lib/email-oauth.js'
import { buildAppointmentConfirmationEmail } from '../lib/email-templates.js'

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

  if (bookedAppointment && callerId) {
    try {
      const supabase = getSupabase()

      const [{ data: location }, { data: tenantRow }] = await Promise.all([
        supabase
          .from('locations')
          .select('telnyx_number')
          .eq('tenant_id', tenantId)
          .eq('is_primary', true)
          .maybeSingle(),
        supabase.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
      ])

      const fromNumber = (location as { telnyx_number?: string | null } | null)?.telnyx_number
      const timezone =
        (tenantRow as { timezone?: string | null } | null)?.timezone ?? 'America/Chicago'

      if (!fromNumber) {
        console.warn('[post-call] SMS skipped — no Telnyx number for tenant')
      } else {
        let appointmentDateTime: string | null = null

        if (appointmentId) {
          const { data: appt } = await supabase
            .from('appointments')
            .select('start_time')
            .eq('id', appointmentId)
            .single()
          if (appt) {
            appointmentDateTime = new Date(
              (appt as { start_time: string }).start_time
            ).toLocaleString('en-US', {
              timeZone: timezone,
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
          } else {
            console.warn('[post-call] SMS appointment not found — sending generic confirmation')
          }
        } else {
          console.info('[post-call] SMS maya_only — sending generic confirmation')
        }

        const smsText = buildConfirmationSms({ businessName, appointmentDateTime, vertical })

        // TCPA: grant SMS consent — verbal/transactional consent from Maya booking
        if (contactId) {
          await grantTcpaOptIn(contactId, tenantId)
        }

        const { success } = await sendSms(fromNumber, callerId, smsText, {
          tenantId,
          contactId: contactId ?? undefined,
        })

        if (success) {
          console.info(
            `[post-call] SMS confirmation sent to=${callerId} appointment=${appointmentId ?? 'none'}`
          )
        } else {
          console.warn('[post-call] SMS confirmation send failed')
        }
      }
    } catch (err) {
      console.error('[post-call] SMS confirmation error:', err)
    }
  }

  // ── Feature 3: Email confirmation after booking (Suite only) ──────────────

  // maya_only has no contact record and no email on file — skip entirely
  if (bookedAppointment && appointmentId && product !== 'maya_only' && contactId) {
    try {
      const supabase = getSupabase()

      const { data: contactRow } = await supabase
        .from('contacts')
        .select('email, full_name')
        .eq('id', contactId)
        .single()

      const contactEmail = (
        contactRow as { email?: string | null; full_name?: string | null } | null
      )?.email

      if (contactEmail) {
        // start_time fetched fresh — SMS block's appointmentDateTime is scoped inside its own try/catch
        const [{ data: appt }, { data: tenantRow }] = await Promise.all([
          supabase.from('appointments').select('start_time').eq('id', appointmentId).single(),
          supabase.from('tenants').select('timezone, name').eq('id', tenantId).maybeSingle(),
        ])

        const tenantData = tenantRow as { timezone?: string | null; name?: string | null } | null
        const timezone = tenantData?.timezone ?? 'America/Chicago'
        const resolvedBusinessName = tenantData?.name?.trim() || businessName

        let appointmentDateTime: string | null = null
        if (appt) {
          appointmentDateTime = new Date(
            (appt as { start_time: string }).start_time
          ).toLocaleString('en-US', {
            timeZone: timezone,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        }

        const contactName = (contactRow as { full_name?: string | null } | null)?.full_name ?? null

        const { subject, html, text } = buildAppointmentConfirmationEmail({
          contactName,
          businessName: resolvedBusinessName,
          appointmentDateTime,
          vertical,
        })

        const trackingToken = crypto.randomUUID()
        const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'
        const trackedHtml = injectTrackingPixel(html, trackingToken, apiUrl)

        // Resolve provider: tenant's default OAuth account, or fall back to Resend
        const { data: emailAccount } = await supabase
          .from('user_email_accounts')
          .select('id, provider, email_address')
          .eq('tenant_id', tenantId)
          .eq('is_default', true)
          .maybeSingle()

        let sent = false
        let fromAddress = process.env['EMAIL_FROM'] ?? 'Maya <maya@nuatis.com>'
        let emailAccountId: string | null = null

        if (emailAccount) {
          const acct = emailAccount as { id: string; provider: string; email_address: string }
          fromAddress = acct.email_address
          emailAccountId = acct.id
          const { accessToken, provider } = await getValidToken(acct.id)
          if (provider === 'gmail') {
            const raw = buildMimeMessage(
              acct.email_address,
              contactEmail,
              subject,
              trackedHtml,
              text
            )
            await sendViaGmail(accessToken, raw)
          } else {
            await sendViaOutlook(accessToken, contactEmail, subject, trackedHtml, text)
          }
          sent = true
        } else {
          sent = await sendEmail({ to: contactEmail, subject, html: trackedHtml })
        }

        if (sent) {
          await supabase.from('email_messages').insert({
            tenant_id: tenantId,
            contact_id: contactId,
            email_account_id: emailAccountId,
            direction: 'outbound',
            from_address: fromAddress,
            to_address: contactEmail,
            subject,
            body_html: trackedHtml,
            body_text: text,
            tracking_token: trackingToken,
          })
          console.info(
            `[post-call] email confirmation sent to=${contactEmail} appointment=${appointmentId}`
          )
        } else {
          console.warn('[post-call] email confirmation send failed')
        }
      }
    } catch (err) {
      console.error('[post-call] email confirmation error:', err)
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
