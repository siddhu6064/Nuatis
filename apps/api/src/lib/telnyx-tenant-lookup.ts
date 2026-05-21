import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export interface TenantPhoneResult {
  tenantId: string
  locationId: string | null
  numberId: string
  department: string
  mayaEnabled: boolean
  label: string
  forwardingNumber: string | null
}

/**
 * Look up tenant by inbound phone number.
 *
 * Priority:
 * 1. TELNYX_TENANT_MAP env var (backwards compat — existing deployments)
 * 2. telnyx_numbers table (new multi-number routing)
 *
 * Returns null if the number is not found anywhere.
 */
export async function getTenantByPhoneNumber(
  phoneNumber: string
): Promise<TenantPhoneResult | null> {
  // Step 1: Check env var map first (backwards compat)
  const tenantMapRaw = process.env['TELNYX_TENANT_MAP'] ?? ''
  if (tenantMapRaw) {
    for (const entry of tenantMapRaw.split(',')) {
      const [phone, tenantId] = entry.trim().split(':')
      if (phone?.trim() === phoneNumber && tenantId?.trim()) {
        return {
          tenantId: tenantId.trim(),
          locationId: null,
          numberId: 'env-map',
          department: 'general',
          mayaEnabled: true,
          label: 'Main Number',
          forwardingNumber: null,
        }
      }
    }
  }

  // Step 2: Query telnyx_numbers table (400ms timeout — must not delay call pickup)
  try {
    const supabase = getSupabase()
    let timedOut = false
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => {
        timedOut = true
        resolve(null)
      }, 400)
    )

    const query = (async (): Promise<TenantPhoneResult | null> => {
      try {
        const { data, error } = await supabase
          .from('telnyx_numbers')
          .select('id, tenant_id, location_id, department, maya_enabled, label, forwarding_number')
          .eq('phone_number', phoneNumber)
          .eq('status', 'active')
          .maybeSingle()

        if (timedOut || error || !data) return null

        const row = data as {
          id: string
          tenant_id: string
          location_id: string | null
          department: string
          maya_enabled: boolean
          label: string
          forwarding_number: string | null
        }

        return {
          tenantId: row.tenant_id,
          locationId: row.location_id,
          numberId: row.id,
          department: row.department,
          mayaEnabled: row.maya_enabled,
          label: row.label,
          forwardingNumber: row.forwarding_number,
        }
      } catch {
        return null
      }
    })()

    return await Promise.race([query, timeout])
  } catch {
    return null
  }
}
