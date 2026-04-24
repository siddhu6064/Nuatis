import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ExpoMessage {
  to: string
  title?: string
  body?: string
  data?: Record<string, string>
  sound?: 'default' | null
  badge?: number
}

/**
 * Send push notification to all active mobile devices for a user.
 * Uses Expo Push API directly (no SDK dependency for flexibility).
 */
export async function sendExpoPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const supabase = getSupabase()

    // Fetch active tokens for this user
    const { data: tokens } = await supabase
      .from('mobile_push_tokens')
      .select('id, expo_token')
      .eq('user_id', userId)
      .eq('is_active', true)

    if (!tokens || tokens.length === 0) return

    const messages: ExpoMessage[] = tokens.map((t) => ({
      to: t.expo_token,
      title,
      body,
      data: data || {},
      sound: 'default',
    }))

    // POST to Expo Push API
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        ...(process.env['EXPO_PUSH_ACCESS_TOKEN']
          ? { Authorization: `Bearer ${process.env['EXPO_PUSH_ACCESS_TOKEN']}` }
          : {}),
      },
      body: JSON.stringify(messages),
    })

    if (!res.ok) {
      console.error('[expo-push] Send failed:', res.status, await res.text())
      return
    }

    const result = (await res.json()) as {
      data?: Array<{ status: string; message?: string; details?: { error?: string } }>
    }

    // Mark invalid tokens as inactive
    if (result.data) {
      for (let i = 0; i < result.data.length; i++) {
        const ticket = result.data[i]
        if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          await supabase
            .from('mobile_push_tokens')
            .update({ is_active: false })
            .eq('id', tokens[i]!.id)
        }
      }
    }
  } catch (err) {
    console.error('[expo-push] Error:', err)
  }
}

/**
 * Send push to all users in a tenant (owner-level notifications).
 */
export async function sendExpoPushToTenant(
  tenantId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const supabase = getSupabase()
    const { data: tokens } = await supabase
      .from('mobile_push_tokens')
      .select('expo_token')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    if (!tokens || tokens.length === 0) return

    const messages: ExpoMessage[] = tokens.map((t) => ({
      to: t.expo_token,
      title,
      body,
      data: data || {},
      sound: 'default',
    }))

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(process.env['EXPO_PUSH_ACCESS_TOKEN']
          ? { Authorization: `Bearer ${process.env['EXPO_PUSH_ACCESS_TOKEN']}` }
          : {}),
      },
      body: JSON.stringify(messages),
    })

    if (!res.ok) {
      console.error('[expo-push] Tenant send failed:', res.status)
    }
  } catch (err) {
    console.error('[expo-push] Tenant error:', err)
  }
}
