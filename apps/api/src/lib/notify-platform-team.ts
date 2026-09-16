import { sendPushNotification } from './push-client.js'

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

  try {
    await sendPushNotification(platformTenantId, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
    })
  } catch (err) {
    console.error('[notify-platform-team] push failed:', err)
  }
}
