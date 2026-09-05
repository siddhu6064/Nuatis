import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import {
  createConnectAccount,
  createOnboardingLink,
  createDashboardLoginLink,
  refreshConnectAccountStatus,
} from '../lib/stripe-connect.js'

const router = Router()

function apiUrl(): string {
  return process.env['API_BASE_URL'] ?? 'http://localhost:3001'
}
function webUrl(): string {
  return process.env['WEB_URL'] ?? 'http://localhost:3000'
}

// ── GET /connect — start/resume Standard Connect onboarding ──────────────────
router.get(
  '/connect',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('billing_email, stripe_connect_account_id')
        .eq('id', authed.tenantId)
        .single()

      let accountId = tenant?.stripe_connect_account_id as string | null | undefined
      if (!accountId) {
        accountId = await createConnectAccount(
          (tenant?.billing_email as string | null) ?? '',
          authed.tenantId
        )
        await supabase
          .from('tenants')
          .update({ stripe_connect_account_id: accountId, stripe_connect_status: 'pending' })
          .eq('id', authed.tenantId)
      }

      const url = await createOnboardingLink(
        accountId,
        `${apiUrl()}/api/stripe-connect/refresh?tenant=${authed.tenantId}`,
        `${apiUrl()}/api/stripe-connect/return?tenant=${authed.tenantId}`
      )
      res.json({ url })
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to start Stripe Connect onboarding',
      })
    }
  }
)

// ── GET /refresh — Account Link expired mid-onboarding (PUBLIC) ─────────────
router.get('/refresh', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.query['tenant'] as string | undefined
  const supabase = getServiceClient()
  const accountId = tenantId ? await lookupAccountId(supabase, tenantId) : null

  if (!tenantId || !accountId) {
    res.redirect(`${webUrl()}/settings/payments?stripe_connect=error`)
    return
  }

  try {
    const url = await createOnboardingLink(
      accountId,
      `${apiUrl()}/api/stripe-connect/refresh?tenant=${tenantId}`,
      `${apiUrl()}/api/stripe-connect/return?tenant=${tenantId}`
    )
    res.redirect(url)
  } catch (err) {
    console.error('[stripe-connect] refresh error:', err)
    res.redirect(`${webUrl()}/settings/payments?stripe_connect=error`)
  }
})

// ── GET /return — tenant lands back here after an onboarding attempt (PUBLIC) ──
router.get('/return', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.query['tenant'] as string | undefined
  const supabase = getServiceClient()
  const accountId = tenantId ? await lookupAccountId(supabase, tenantId) : null

  if (!tenantId || !accountId) {
    res.redirect(`${webUrl()}/settings/payments?stripe_connect=error`)
    return
  }

  try {
    await refreshConnectAccountStatus(supabase, tenantId, accountId)
  } catch (err) {
    console.error('[stripe-connect] return status refresh error:', err)
  }
  res.redirect(`${webUrl()}/settings/payments?stripe_connect=return`)
})

async function lookupAccountId(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('stripe_connect_account_id')
    .eq('id', tenantId)
    .maybeSingle()
  return (data?.stripe_connect_account_id as string | null) ?? null
}

// ── GET /status — current connection state (authed) ─────────────────────────
router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(
      'stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, stripe_connect_payouts_enabled'
    )
    .eq('id', authed.tenantId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!tenant?.stripe_connect_account_id) {
    res.json({ connected: false, status: 'none' })
    return
  }

  res.json({
    connected: true,
    status: tenant.stripe_connect_status,
    charges_enabled: tenant.stripe_connect_charges_enabled,
    payouts_enabled: tenant.stripe_connect_payouts_enabled,
    account_id: tenant.stripe_connect_account_id,
  })
})

// ── GET /dashboard-link — one-time login link to the tenant's own Stripe dashboard ──
router.get(
  '/dashboard-link',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_connect_account_id, stripe_connect_charges_enabled')
      .eq('id', authed.tenantId)
      .maybeSingle()

    const accountId = tenant?.stripe_connect_account_id as string | null | undefined
    if (!accountId || !tenant?.stripe_connect_charges_enabled) {
      res.status(400).json({ error: 'Stripe account is not fully onboarded yet' })
      return
    }

    try {
      const url = await createDashboardLoginLink(accountId)
      res.json({ url })
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'Failed to create dashboard link' })
    }
  }
)

// ── DELETE /disconnect — clear the local reference ──────────────────────────
// Standard accounts are owned by the tenant, not Nuatis — there's no
// deauthorize call to make (that's an OAuth-app concept, not how
// accounts.create()-based Standard Connect works). This only stops Nuatis
// from routing new payments to it; the tenant's own Stripe account and its
// history are completely untouched, and they can reconnect the same account
// or a different one later.
router.delete(
  '/disconnect',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { error } = await supabase
      .from('tenants')
      .update({
        stripe_connect_account_id: null,
        stripe_connect_status: 'none',
        stripe_connect_charges_enabled: false,
        stripe_connect_payouts_enabled: false,
        stripe_connect_onboarded_at: null,
      })
      .eq('id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ success: true })
  }
)

export default router
