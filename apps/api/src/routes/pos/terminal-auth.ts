import { Router, type Request, type Response } from 'express'
import { SignJWT } from 'jose'
import { getServiceClient } from '../../lib/supabase.js'
import { verifyPin } from '../../lib/pos-pin.js'

const router = Router()

interface StaffRow {
  id: string
  tenant_id: string
  name: string | null
  pos_pin_hash: string | null
  pos_location_ids: string[] | null
  is_active: boolean
}

// ── POST /api/pos/terminal/sign-in ──────────────────────────────────────────
// A register signs in with a numeric PIN. The PIN is a convenience credential
// for a shared physical device, not a password — the minted token carries
// portalScope 'pos', which requireAuth confines to /api/pos/*, and is bound to
// a single location.
router.post('/sign-in', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>
  const tenantId = typeof body['tenant_id'] === 'string' ? body['tenant_id'] : ''
  const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
  const pin = typeof body['pin'] === 'string' ? body['pin'] : ''

  if (!tenantId || !locationId || !pin) {
    res.status(400).json({ error: 'tenant_id, location_id, and pin are required' })
    return
  }

  const secret = process.env['AUTH_SECRET']
  if (!secret) {
    res.status(503).json({ error: 'Auth not configured' })
    return
  }

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('staff_members')
    .select('id, tenant_id, name, pos_pin_hash, pos_location_ids, is_active')
    .eq('tenant_id', tenantId)

  const candidates = ((data ?? []) as StaffRow[]).filter(
    (s) =>
      s.tenant_id === tenantId &&
      s.is_active &&
      s.pos_pin_hash &&
      (s.pos_location_ids ?? []).includes(locationId)
  )

  // Compare against every candidate even after a match, so response time does
  // not reveal how many staff share a location or where a matching PIN sits in
  // the list.
  let matched: StaffRow | null = null
  for (const candidate of candidates) {
    const ok = await verifyPin(pin, candidate.pos_pin_hash as string)
    if (ok && !matched) matched = candidate
  }

  if (!matched) {
    // Identical shape for a wrong PIN, an unknown tenant, and an unassigned
    // location — a terminal login must not be an enumeration oracle.
    res.status(401).json({ error: 'Invalid PIN' })
    return
  }

  const token = await new SignJWT({
    sub: `pos:${matched.id}`,
    tenantId: matched.tenant_id,
    staffId: matched.id,
    locationId,
    portalScope: 'pos',
    role: 'staff',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('nuatis-web')
    .setAudience('nuatis-api')
    // A register sits on a counter all day; a short expiry would force a
    // re-PIN mid-service. One shift is the right ceiling.
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(secret))

  res.json({
    token,
    staff: { id: matched.id, name: matched.name },
    locationId,
  })
})

export default router
