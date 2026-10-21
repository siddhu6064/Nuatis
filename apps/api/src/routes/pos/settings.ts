import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { requirePos } from './menu.js'

const router = Router()

/**
 * What a register needs to know before it can price anything.
 *
 * Exists because a POS token is confined to /api/pos/* by requireAuth, so the
 * register cannot read the tenant's tax rate from the ordinary settings
 * routes. Read-only, and deliberately narrow — it returns what a till displays
 * and what it needs to compute a total, nothing else.
 */
router.get('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''
  if (!locationId) {
    res.status(400).json({ error: 'location_id is required' })
    return
  }

  const supabase = getServiceClient()

  const { data: location } = await supabase
    .from('locations')
    .select('id, name')
    .eq('id', locationId)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle<{ id: string; name: string | null }>()

  if (!location) {
    res.status(404).json({ error: 'Location not found' })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, tax_rate, timezone, incident_auth_threshold_cents')
    .eq('id', authed.tenantId)
    .maybeSingle<{
      name: string | null
      tax_rate: string | null
      timezone: string | null
      incident_auth_threshold_cents: number | null
    }>()

  // tenants.tax_rate is a percentage (8.75 means 8.75%), but cartTotals works
  // in integer basis points. Convert here so no caller has to remember which
  // unit it received, and round: 8.125% is 812.5 bps, and a fractional bps
  // would put a fraction of a cent into the tax calculation.
  const taxPercent = Number(tenant?.tax_rate ?? 0)
  const taxRateBps = Number.isFinite(taxPercent) ? Math.round(taxPercent * 100) : 0

  res.json({
    business_name: tenant?.name ?? null,
    location_id: location.id,
    location_name: location.name,
    timezone: tenant?.timezone ?? 'America/Chicago',
    tax_rate_bps: taxRateBps,
    // Above this, reporting an incident asks for a manager PIN. The register
    // needs it so it knows when to show the PIN pad; the server enforces the
    // rule regardless. Null means the DEFAULT_AUTH_THRESHOLD_CENTS in
    // lib/incidents.ts, which the client mirrors.
    incident_auth_threshold_cents: tenant?.incident_auth_threshold_cents ?? null,
  })
})

export default router
