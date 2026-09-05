import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/settings/customer-referrals ────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(
      'customer_referral_program_enabled, customer_referral_reward_cents, customer_referral_referred_reward_cents'
    )
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({
    enabled: tenant.customer_referral_program_enabled ?? false,
    referrerRewardCents: tenant.customer_referral_reward_cents ?? 1000,
    referredRewardCents: tenant.customer_referral_referred_reward_cents ?? 0,
  })
})

// ── PATCH /api/settings/customer-referrals ───────────────────────────────────
router.patch('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  if (typeof b['enabled'] === 'boolean') {
    updates['customer_referral_program_enabled'] = b['enabled']
  }

  if (typeof b['referrerRewardCents'] === 'number') {
    const cents = Math.round(b['referrerRewardCents'])
    if (cents < 0 || cents > 100000) {
      res.status(400).json({ error: 'referrerRewardCents must be between 0 and 100000' })
      return
    }
    updates['customer_referral_reward_cents'] = cents
  }

  if (typeof b['referredRewardCents'] === 'number') {
    const cents = Math.round(b['referredRewardCents'])
    if (cents < 0 || cents > 100000) {
      res.status(400).json({ error: 'referredRewardCents must be between 0 and 100000' })
      return
    }
    updates['customer_referral_referred_reward_cents'] = cents
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }

  const { error } = await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'customer_referral_program_enabled, customer_referral_reward_cents, customer_referral_referred_reward_cents'
    )
    .eq('id', authed.tenantId)
    .single()

  res.json({
    enabled: tenant?.customer_referral_program_enabled ?? false,
    referrerRewardCents: tenant?.customer_referral_reward_cents ?? 1000,
    referredRewardCents: tenant?.customer_referral_referred_reward_cents ?? 0,
  })
})

export default router
