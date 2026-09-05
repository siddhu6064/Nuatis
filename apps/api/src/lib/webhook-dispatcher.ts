import { getServiceClient } from './supabase.js'
import { getWebhookDeliveryQueue } from './webhook-delivery-queue.js'

// Single source of truth for which events a tenant can subscribe to — kept
// here (not duplicated in routes/webhooks.ts) since this is also the list of
// events actually dispatched. Previously these drifted apart: routes/webhooks.ts
// had its own separate, stale allow-list that rejected 4 event types this file
// already dispatched (quote.sent, quote.accepted, quote.declined,
// outreach_sequence.step_sent) — a tenant could never subscribe to them even
// though they fired — and allowed 'appointment.booked', which was never
// actually dispatched anywhere. Fixed by dispatching appointment.booked at its
// two real creation points and making routes/webhooks.ts import this list.
export const WEBHOOK_EVENT_TYPES = [
  'call.completed',
  'appointment.booked',
  'appointment.no_show',
  'contact.created',
  'follow_up.sent',
  'quote.sent',
  'quote.accepted',
  'quote.declined',
  'outreach_sequence.step_sent',
  'deal.won',
  'deal.lost',
  'invoice.paid',
] as const

/**
 * Looks up this tenant's active subscriptions for `eventType` and enqueues one
 * delivery job per match — the actual HTTP POST (signing, retry, delivery
 * logging) happens in the webhook-delivery worker, not inline here, so a slow
 * or unreachable subscriber URL can't block whatever route/worker fired the
 * event. Previously this function did the fetch inline, single-attempt, with
 * no record of a failed delivery — a dead subscriber URL silently dropped
 * every event, forever, with no way for a tenant to even notice.
 */
export async function dispatchWebhook(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getServiceClient()

    const { data: subs, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, event_types')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    if (error || !subs || subs.length === 0) return

    const matching = subs.filter((sub) => ((sub.event_types as string[]) ?? []).includes(eventType))
    if (matching.length === 0) return

    const queue = getWebhookDeliveryQueue()

    for (const sub of matching) {
      const { data: delivery, error: insertError } = await supabase
        .from('webhook_deliveries')
        .insert({
          tenant_id: tenantId,
          subscription_id: sub.id,
          event_type: eventType,
          payload,
          status: 'pending',
        })
        .select('id')
        .single()

      if (insertError || !delivery) {
        console.error(`[webhook] failed to log delivery for ${eventType}:`, insertError)
        continue
      }

      await queue.add(
        'deliver',
        { deliveryId: delivery.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } }
      )
    }
  } catch (err) {
    console.error('[webhook] dispatcher error:', err)
  }
}
