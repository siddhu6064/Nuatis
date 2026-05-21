import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { generateReferralCode } from '../lib/referral.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/referrals/my-code (authenticated) ───────────────────────────────
router.get('/my-code', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  try {
    const supabase = getSupabase()

    // Try to find existing referral code for tenant
    let { data: row, error } = await supabase
      .from('referral_codes')
      .select('id, code, clicks, signups, commission_rate, status')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // If none found, generate one
    if (!row) {
      // Fetch tenant's business_name
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('business_name')
        .eq('id', authed.tenantId)
        .maybeSingle()

      if (tenantError) {
        res.status(500).json({ error: tenantError.message })
        return
      }

      const businessName = tenant?.business_name ?? 'Nuatis'
      await generateReferralCode(authed.tenantId, businessName)

      // Re-query to get the full row
      const { data: newRow, error: newRowError } = await supabase
        .from('referral_codes')
        .select('id, code, clicks, signups, commission_rate, status')
        .eq('tenant_id', authed.tenantId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (newRowError || !newRow) {
        res.status(500).json({ error: newRowError?.message ?? 'Failed to retrieve referral code' })
        return
      }

      row = newRow
    }

    res.json({
      id: row.id,
      code: row.code,
      clicks: row.clicks,
      signups: row.signups,
      commission_rate: row.commission_rate,
      status: row.status,
      referral_url: `https://app.nuatis.com/signup?ref=${row.code}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── GET /api/referrals/signups (authenticated) ───────────────────────────────
router.get('/signups', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  try {
    const supabase = getSupabase()

    // Fetch all signups for this tenant
    const { data: signups, error: signupsError } = await supabase
      .from('referral_signups')
      .select('*')
      .eq('referring_tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (signupsError) {
      res.status(500).json({ error: signupsError.message })
      return
    }

    const allSignups = signups ?? []
    const activeCount = allSignups.filter((s: { status: string }) => s.status === 'active').length

    // Fetch commission_rate from first referral code (default 10)
    const { data: codeRow } = await supabase
      .from('referral_codes')
      .select('commission_rate')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const commissionRate: number = codeRow?.commission_rate ?? 10
    const estimated_mrr = activeCount * 149 * (commissionRate / 100)

    res.json({
      signups: allSignups,
      estimated_mrr,
      total: allSignups.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── GET /api/referrals/track/:code (public) ──────────────────────────────────
// MUST be after /my-code and /signups to avoid route conflict
router.get('/track/:code', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.params

  try {
    const supabase = getSupabase()

    const { data: row, error } = await supabase
      .from('referral_codes')
      .select('id, code, clicks')
      .eq('code', code)
      .maybeSingle()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    if (!row) {
      res.status(404).json({ error: 'Referral code not found' })
      return
    }

    // Increment clicks
    await supabase
      .from('referral_codes')
      .update({ clicks: row.clicks + 1 })
      .eq('id', row.id)

    res.redirect(302, `https://app.nuatis.com/signup?ref=${code}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── POST /api/referrals/signup (public) ──────────────────────────────────────
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const { code, email } = req.body as {
    code?: string
    email?: string
  }

  if (!email || typeof email !== 'string' || email.trim() === '') {
    res.status(400).json({ error: 'email is required' })
    return
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code is required' })
    return
  }

  try {
    const supabase = getSupabase()

    // Validate referral code exists and is active
    const { data: row, error } = await supabase
      .from('referral_codes')
      .select('id, tenant_id, code, signups, status')
      .eq('code', code)
      .maybeSingle()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    if (!row || row.status !== 'active') {
      res.status(404).json({ error: 'Invalid or inactive referral code' })
      return
    }

    // Insert signup record
    const { error: insertError } = await supabase.from('referral_signups').insert({
      referral_code_id: row.id,
      referring_tenant_id: row.tenant_id,
      referred_email: email.trim(),
      status: 'signed_up',
    })

    if (insertError) {
      res.status(500).json({ error: insertError.message })
      return
    }

    // Increment signups count on the referral code
    await supabase
      .from('referral_codes')
      .update({ signups: row.signups + 1 })
      .eq('id', row.id)

    // Fire-and-forget notification (best effort — just log)
    void (async () => {
      try {
        console.log(`[referrals] new signup via code ${code}: ${email}`)
      } catch {}
    })()

    res.status(201).json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
