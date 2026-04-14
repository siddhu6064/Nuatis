import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

let vapidConfigured = false

function ensureVapid(): boolean {
  if (vapidConfigured) return true
  const publicKey = process.env['VAPID_PUBLIC_KEY']
  const privateKey = process.env['VAPID_PRIVATE_KEY']
  const email = process.env['VAPID_EMAIL'] ?? 'mailto:sid@nuatis.com'
  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID keys not set — push disabled')
    return false
  }
  webpush.setVapidDetails(email, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export async function sendPushNotification(
  tenantId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!ensureVapid()) return

  try {
    const supabase = getSupabase()
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('tenant_id', tenantId)

    if (!subs || subs.length === 0) return

    let sent = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload)
        )
        sent++
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 410 || status === 404) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          console.info(`[push] removed stale subscription: ${sub.endpoint.slice(0, 50)}...`)
        }
      }
    }

    if (sent > 0) {
      console.info(`[push] sent "${payload.title}" to ${sent} devices for tenant=${tenantId}`)
    }
  } catch (err) {
    console.error('[push] sendPushNotification error:', err)
  }
}
