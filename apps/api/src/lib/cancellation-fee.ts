import type { SupabaseClient } from '@supabase/supabase-js'
import { createPaymentLink } from './payment-link.js'
import { chargeContactSavedMethod } from './contact-payment-methods.js'

// Shared by every path that cancels an appointment — staff (appointments.ts),
// the public manage-booking link (booking-manage.ts), and the client portal
// (portal.ts). Tries a saved card/bank on file first, falls back to a hosted
// payment link. Fire-and-forget by design (matches the original staff-side
// IIFE this was extracted from) — a Stripe hiccup must never block the
// cancellation itself.
export async function applyLateCancellationFee(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    appointmentId: string | undefined
    contactId: string | null | undefined
    startTime: string | null | undefined
  }
): Promise<void> {
  const { tenantId, appointmentId, contactId, startTime } = params
  try {
    if (!contactId || !startTime || !appointmentId) return

    const { data: tenant } = await supabase
      .from('tenants')
      .select('no_show_fee_cents, cancellation_fee_notice_hours')
      .eq('id', tenantId)
      .single()

    const feeCents = tenant?.no_show_fee_cents as number | null | undefined
    const noticeHours = tenant?.cancellation_fee_notice_hours as number | null | undefined
    if (!feeCents || feeCents <= 0 || !noticeHours) return

    const hoursUntil = (new Date(startTime).getTime() - Date.now()) / 3_600_000
    if (hoursUntil > noticeHours) return

    const charge = await chargeContactSavedMethod(supabase, {
      tenantId,
      contactId,
      amountCents: feeCents,
      description: 'Late cancellation fee',
    })

    if (charge.charged) {
      await supabase
        .from('appointments')
        .update({
          fee_amount_cents: feeCents,
          fee_status: 'charged',
          fee_payment_intent_id: charge.paymentIntentId,
        })
        .eq('id', appointmentId)
      return
    }

    const link = await createPaymentLink({
      tenantId,
      amount: feeCents / 100,
      description: 'Late cancellation fee',
      contactId,
    })
    await supabase
      .from('appointments')
      .update({
        fee_amount_cents: feeCents,
        fee_payment_link_url: link.url,
        fee_status: 'link_sent',
      })
      .eq('id', appointmentId)
  } catch (err) {
    console.error(`[cancellation-fee] error for appointment=${appointmentId}:`, err)
  }
}
