import { sendPushNotification } from './push-client.js'
import { getServiceClient } from './supabase.js'

/**
 * Tell the Nuatis team about an internal incident.
 *
 * **Never use `notifyOwner` for this.** That function targets a merchant's
 * tenant, and reaching for it here would send an internal outage notice to
 * every customer.
 *
 * Transports are the two that exist today:
 *
 *   1. Web push to the platform tenant — the same machinery notifyOwner uses,
 *      aimed at the internal tenant whose owner logs into the admin console.
 *   2. An optional outbound webhook (PLATFORM_ALERT_WEBHOOK_URL), Slack-shaped,
 *      because an internal ops alert usually wants to land in a channel.
 *
 * Email is deliberately absent. There is no transactional email provider in
 * this codebase — lib/email-send.ts is per-tenant Gmail/Outlook OAuth for
 * merchant mailboxes and is the wrong tool. Adding an email branch that cannot
 * send would be a notifier that silently drops alerts, which is worse than not
 * offering the channel.
 *
 * Fire-and-forget and never throws: a failed notification must not fail the
 * incident operation that triggered it.
 *
 * It does, however, refuse to fail *silently*. Web push returns early with no
 * log at all when the tenant has no subscriptions, so an alert with neither
 * transport available would otherwise vanish without trace — which is the worst
 * possible behaviour for the thing that tells you production is on fire.
 */
export async function notifyPlatformTeam(
  eventType: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const platformTenantId = process.env['PLATFORM_TENANT_ID']
  if (!platformTenantId) {
    console.warn(`[notify-platform-team] PLATFORM_TENANT_ID unset — dropping ${eventType}`)
    return
  }

  const webhookUrl = process.env['PLATFORM_ALERT_WEBHOOK_URL']
  if (webhookUrl) {
    // Caught on its own: one broken Slack URL must not cost the team the push.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${payload.title}*\n${payload.body}`,
          event_type: eventType,
          url: payload.url ?? null,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      console.error('[notify-platform-team] webhook failed:', err)
    } finally {
      clearTimeout(timeout)
    }
  }

  let pushTargets = 0
  try {
    const supabase = getServiceClient()
    const { count } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', platformTenantId)
    pushTargets = count ?? 0

    await sendPushNotification(platformTenantId, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
    })
  } catch (err) {
    console.error('[notify-platform-team] push failed:', err)
  }

  // The failure this guards against is silence, not an error.
  //
  // sendPushNotification returns early and logs NOTHING when the tenant has no
  // push subscriptions, so an alert with no webhook and no subscribed browser
  // disappears without leaving a trace — the worst possible behaviour for the
  // thing that tells you production is on fire. Say so loudly instead.
  if (!webhookUrl && pushTargets === 0) {
    console.error(
      `[notify-platform-team] ALERT UNDELIVERABLE (${eventType}): the platform tenant has no ` +
        'push subscriptions and PLATFORM_ALERT_WEBHOOK_URL is unset, so this alert reached ' +
        'nobody. Set PLATFORM_ALERT_WEBHOOK_URL, or open the admin console and enable ' +
        'notifications.'
    )
  }
}
