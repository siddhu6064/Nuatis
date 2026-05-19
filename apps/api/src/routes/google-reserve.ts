import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// POST /api/google-reserve/submit
router.post('/submit', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const locationId = typeof b['locationId'] === 'string' ? b['locationId'].trim() : null
  if (!locationId) {
    res.status(400).json({ error: 'locationId is required' })
    return
  }

  // Fetch location + tenant data for validation
  const { data: location, error: locError } = await supabase
    .from('locations')
    .select('id, name, phone, address, google_place_id, google_reserve_status')
    .eq('id', locationId)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()

  if (locError || !location) {
    res.status(404).json({ error: 'Location not found' })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name, booking_page_slug, booking_page_enabled')
    .eq('id', authed.tenantId)
    .single()

  // Validate required fields
  const missing: string[] = []
  if (!tenant?.business_name) missing.push('business name')
  if (!location.phone && !tenant) missing.push('phone number')
  if (!location.address) missing.push('address')
  if (!tenant?.booking_page_slug || !tenant?.booking_page_enabled)
    missing.push('active booking page')
  if (!(location as Record<string, unknown>)['google_place_id']) missing.push('Google Place ID')

  if (missing.length > 0) {
    res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
    })
    return
  }

  const currentStatus = (location as Record<string, unknown>)['google_reserve_status'] as string
  if (currentStatus === 'approved') {
    res.status(400).json({ error: 'Already approved — no resubmission needed' })
    return
  }

  const bookingUrl = `https://nuatis.com/book/${tenant!.booking_page_slug}`

  // TODO: Call Google Reserve API once partner credentials are provisioned.
  // POST https://mapsbooking.googleapis.com/v1alpha/inventory:batchPush
  // with partner credentials from GOOGLE_RESERVE_PARTNER_ID + GOOGLE_RESERVE_SERVICE_ACCOUNT_KEY.
  // Reference: https://developers.google.com/maps-booking/reference/rest/v1alpha/inventory/batchPush

  // Update location status
  const { error: updateError } = await supabase
    .from('locations')
    .update({ google_reserve_status: 'pending_approval' })
    .eq('id', locationId)
    .eq('tenant_id', authed.tenantId)

  if (updateError) {
    res.status(500).json({ error: updateError.message })
    return
  }

  // Log submission to audit_log
  await supabase.from('audit_log').insert({
    tenant_id: authed.tenantId,
    user_id: authed.userId ?? null,
    action: 'google_reserve.submit',
    resource_type: 'location',
    resource_id: locationId,
    details: {
      booking_url: bookingUrl,
      place_id: (location as Record<string, unknown>)['google_place_id'],
      business_name: tenant!.business_name,
    },
    ip_address: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  })

  res.json({
    status: 'pending_approval',
    message: 'Submission recorded. Google review takes 2–4 weeks.',
  })
})

// GET /api/google-reserve/status/:locationId
router.get(
  '/status/:locationId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: location, error } = await supabase
      .from('locations')
      .select('google_reserve_status, google_reserve_merchant_id, google_place_id')
      .eq('id', req.params['locationId'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (error || !location) {
      res.status(404).json({ error: 'Location not found' })
      return
    }

    res.json({
      status: (location as Record<string, unknown>)['google_reserve_status'] ?? 'not_submitted',
      merchant_id: (location as Record<string, unknown>)['google_reserve_merchant_id'] ?? null,
      place_id: (location as Record<string, unknown>)['google_place_id'] ?? null,
    })
  }
)

export default router
