import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function dispatchWebhook(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabase()

    const { data: subs, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, url, secret, event_types')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    if (error || !subs || subs.length === 0) return

    for (const sub of subs) {
      const eventTypes: string[] = sub.event_types ?? []
      if (!eventTypes.includes(eventType)) continue

      const body = JSON.stringify({
        event: eventType,
        tenant_id: tenantId,
        timestamp: new Date().toISOString(),
        data: payload,
      })

      const signature = sub.secret
        ? createHmac('sha256', sub.secret).update(body).digest('hex')
        : ''

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      try {
        await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(signature ? { 'X-Webhook-Signature': signature } : {}),
          },
          body,
          signal: controller.signal,
        })

        console.info(`[webhook] dispatched ${eventType} to ${sub.url} for tenant=${tenantId}`)
      } catch (err) {
        console.warn(`[webhook] failed to dispatch ${eventType} to ${sub.url}:`, err)
      } finally {
        clearTimeout(timeout)
      }
    }
  } catch (err) {
    console.error('[webhook] dispatcher error:', err)
  }
}
