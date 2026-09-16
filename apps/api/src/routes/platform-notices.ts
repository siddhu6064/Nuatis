import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

/**
 * The ONLY tenant-facing view of a platform incident.
 *
 * It selects `customer_message` and its publish timestamp and nothing else.
 * `title`, `summary`, `component`, `severity`, `reference` and the event
 * timeline are internal and are never on this path — a structural guarantee
 * rather than a review habit, and the reason the customer text lives in its own
 * column instead of being a flag on the internal one.
 *
 * No platform-owner guard here: this is for merchants. It is scoped to the
 * caller's own tenant through platform_incident_tenants.
 */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: links } = await supabase
    .from('platform_incident_tenants')
    .select('incident_id, impact')
    .eq('tenant_id', authed.tenantId)

  // 'none' means we checked and this merchant was not affected. Recording that
  // is useful internally; showing them a notice about it is not.
  const affected = ((links ?? []) as { incident_id: string; impact: string }[]).filter(
    (l) => l.impact !== 'none'
  )
  if (affected.length === 0) {
    res.json({ notices: [] })
    return
  }

  const { data, error } = await supabase
    .from('platform_incidents')
    .select('id, customer_message, customer_message_published_at, resolved_at')
    .in(
      'id',
      affected.map((l) => l.incident_id)
    )
    .not('customer_message_published_at', 'is', null)
    .order('customer_message_published_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = (data ?? []) as {
    id: string
    customer_message: string | null
    customer_message_published_at: string
    resolved_at: string | null
  }[]

  // Reshaped field by field rather than spread, so a column added to
  // platform_incidents later cannot silently start appearing here.
  res.json({
    notices: rows.map((r) => ({
      id: r.id,
      message: r.customer_message,
      published_at: r.customer_message_published_at,
      resolved_at: r.resolved_at,
    })),
  })
})

export default router
