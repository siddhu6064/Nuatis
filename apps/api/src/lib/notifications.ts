import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from './push-client.js'
// sendSms import reserved for future: owner SMS requires personal phone field on users table
// import { sendSms } from './sms.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface NotificationPrefs {
  [eventType: string]: {
    push?: boolean
    sms?: boolean
    email?: boolean
  }
}

/**
 * Central notification dispatcher.
 * Checks tenant notification_prefs before dispatching push / SMS / email.
 * Fire-and-forget — never throws, logs errors internally.
 */
export async function notifyOwner(
  tenantId: string,
  eventType: string,
  payload: {
    pushTitle?: string
    pushBody?: string
    pushUrl?: string
    smsBody?: string
  }
): Promise<void> {
  try {
    const supabase = getSupabase()

    // 1. Fetch tenant notification prefs
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('notification_prefs')
      .eq('id', tenantId)
      .single()

    if (tenantError) {
      console.error(`[notifications] failed to fetch tenant ${tenantId}:`, tenantError)
      return
    }

    // 2. Resolve prefs for this event type
    //    Default to push=true for all events when prefs are not configured (backwards compat)
    const prefs = tenant?.notification_prefs as NotificationPrefs | null | undefined

    let pushEnabled = true
    let smsEnabled = false

    if (prefs != null) {
      const eventPrefs = prefs[eventType]
      if (eventPrefs != null) {
        pushEnabled = eventPrefs.push ?? false
        smsEnabled = eventPrefs.sms ?? false
      } else {
        // Event type not found in prefs — default push on, sms off
        pushEnabled = true
        smsEnabled = false
      }
    }

    // 3. Push notification
    if (pushEnabled && payload.pushTitle) {
      await sendPushNotification(tenantId, {
        title: payload.pushTitle,
        body: payload.pushBody ?? '',
        url: payload.pushUrl,
      })
    }

    // 4. SMS to owner
    //    The owner's personal phone is not stored in the users table.
    //    The telnyx_number on locations is the business outbound number, not the owner's personal phone.
    //    Until a personal phone field is added to the users table, SMS-to-owner is not available.
    if (smsEnabled && payload.smsBody) {
      console.warn(
        `[notifications] SMS to owner not available — no personal phone on file (tenant=${tenantId}, event=${eventType})`
      )
    }
  } catch (err) {
    console.error('[notifications] notifyOwner error:', err)
  }
}
