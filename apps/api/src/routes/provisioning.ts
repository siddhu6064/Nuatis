import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
// config/urls.js available for future phone configuration

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── POST /api/provisioning/provision-phone ────────────────────────────────────
router.post('/provision-phone', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const areaCode = typeof req.body?.area_code === 'string' ? req.body.area_code : '512'
  const apiKey = process.env['TELNYX_API_KEY']

  if (!apiKey) {
    res.status(503).json({ error: 'Phone provisioning not configured' })
    return
  }

  try {
    // 1. Search for available numbers
    const searchParams = new URLSearchParams({
      'filter[country_code]': 'US',
      'filter[national_destination_code]': areaCode,
      'filter[features][]': 'sms',
      'filter[limit]': '5',
    })

    const searchRes = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${searchParams}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )

    if (!searchRes.ok) {
      const body = await searchRes.text()
      console.error(`[provisioning] search failed (${searchRes.status}): ${body}`)
      res.status(502).json({ error: 'Failed to search available numbers' })
      return
    }

    const searchData = (await searchRes.json()) as {
      data?: Array<{ phone_number: string }>
    }
    const available = searchData.data ?? []

    if (available.length === 0) {
      res.status(404).json({ error: `No numbers available for area code ${areaCode}` })
      return
    }

    const selectedNumber = available[0]!.phone_number

    // 2. Order the number
    const orderBody: Record<string, unknown> = {
      phone_numbers: [{ phone_number: selectedNumber }],
    }

    const connectionId = process.env['TELNYX_CONNECTION_ID']
    if (connectionId) orderBody['connection_id'] = connectionId

    const orderRes = await fetch('https://api.telnyx.com/v2/number_orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBody),
    })

    if (!orderRes.ok) {
      const body = await orderRes.text()
      console.error(`[provisioning] order failed (${orderRes.status}): ${body}`)
      res.status(502).json({ error: 'Failed to order phone number' })
      return
    }

    // 3. Update locations table
    const supabase = getSupabase()
    const { error: updateErr } = await supabase
      .from('locations')
      .update({ telnyx_number: selectedNumber })
      .eq('tenant_id', authed.tenantId)
      .eq('is_primary', true)

    if (updateErr) {
      console.error(`[provisioning] location update error: ${updateErr.message}`)
    }

    // 4. Update TELNYX_TENANT_MAP would need manual config — log for now
    console.info(
      `[provisioning] phone provisioned: number=${selectedNumber} tenant=${authed.tenantId}`
    )
    console.info(
      `[provisioning] ACTION REQUIRED: Add ${selectedNumber}:${authed.tenantId} to TELNYX_TENANT_MAP`
    )

    res.json({ phone_number: selectedNumber, area_code: areaCode })
  } catch (err) {
    console.error('[provisioning] provision-phone error:', err)
    res.status(500).json({ error: 'Phone provisioning failed' })
  }
})

// ── GET /api/provisioning/onboarding-status ───────────────────────────────────
router.get(
  '/onboarding-status',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    try {
      const [tenantRes, locationRes, callRes] = await Promise.all([
        supabase
          .from('tenants')
          .select('vertical, onboarding_completed, onboarding_step, product')
          .eq('id', authed.tenantId)
          .single(),
        supabase
          .from('locations')
          .select('telnyx_number, google_refresh_token')
          .eq('tenant_id', authed.tenantId)
          .eq('is_primary', true)
          .maybeSingle(),
        supabase
          .from('voice_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', authed.tenantId),
      ])

      const tenant = tenantRes.data
      const location = locationRes.data

      res.json({
        tenant_created: true,
        vertical_set: !!tenant?.vertical,
        phone_provisioned: !!location?.telnyx_number,
        calendar_connected: !!location?.google_refresh_token,
        business_hours_set: true,
        maya_tested: (callRes.count ?? 0) > 0,
        plan_selected: false,
        onboarding_completed: tenant?.onboarding_completed ?? false,
        onboarding_step: tenant?.onboarding_step ?? 1,
        product: (tenant?.product as string) ?? 'suite',
      })
    } catch (err) {
      console.error('[provisioning] onboarding-status error:', err)
      res.status(500).json({ error: 'Failed to fetch onboarding status' })
    }
  }
)

// ── POST /api/provisioning/complete-step ──────────────────────────────────────
router.post('/complete-step', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const step = typeof req.body?.step === 'number' ? req.body.step : null

  if (!step || step < 1 || step > 6) {
    res.status(400).json({ error: 'Invalid step' })
    return
  }

  try {
    const supabase = getSupabase()
    const updates: Record<string, unknown> = { onboarding_step: step + 1 }
    if (step >= 6) updates['onboarding_completed'] = true

    await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

    res.json({ step: step + 1, completed: step >= 6 })
  } catch (err) {
    console.error('[provisioning] complete-step error:', err)
    res.status(500).json({ error: 'Failed to update step' })
  }
})

// ── POST /api/provisioning/upgrade-to-suite ───────────────────────────────────
router.post(
  '/upgrade-to-suite',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest

    if (authed.role !== 'owner') {
      res.status(403).json({ error: 'Only workspace owners can upgrade to suite' })
      return
    }

    try {
      const supabase = getSupabase()
      await supabase
        .from('tenants')
        .update({
          product: 'suite',
          modules: {
            maya: true,
            crm: true,
            revenue_ops: true,
            cpq: true,
            insights: true,
            appointments: true,
            pipeline: true,
            automation: true,
            companies: true,
            deals: true,
          },
        })
        .eq('id', authed.tenantId)

      console.info(`[provisioning] tenant upgraded to suite: ${authed.tenantId}`)
      res.json({ upgraded: true, product: 'suite' })
    } catch (err) {
      console.error('[provisioning] upgrade error:', err)
      res.status(500).json({ error: 'Failed to upgrade' })
    }
  }
)

export default router
