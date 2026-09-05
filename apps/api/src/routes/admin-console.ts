/**
 * Internal admin console for Nuatis's own team — cross-tenant tenant listing,
 * support, and impersonation. Reuses the existing "platform tenant" pattern
 * (insights.ts's GET /plg is the precedent) rather than building a new
 * tenant-less/superuser auth mode: a designated internal tenant
 * (PLATFORM_TENANT_ID) whose 'owner'-role login is trusted with cross-tenant
 * reads and, for impersonation specifically, a genuine read-write session
 * into a target tenant — fingerprinted end to end (lib/impersonation.ts).
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { PLANS, type PlanKey } from '../config/stripe-plans.js'
import { startImpersonationSession, endImpersonationSession } from '../lib/impersonation.js'
import { getFeatureUsageSummary } from '../lib/feature-usage.js'

// subscription_status has known pollution in prod beyond the 4 labels
// current code writes (trialing/active/past_due/canceled) — see
// prod-verified-invariants memory. Both spellings of "canceled" exist, plus
// unpaid/paused/incomplete from earlier Stripe webhook handling. Bucket
// defensively rather than assuming only the clean 4 ever appear.
const CANCELED_STATUSES = new Set(['canceled', 'cancelled'])
const CONVERTED_STATUSES = new Set(['active'])
const TRIALING_STATUSES = new Set(['trialing'])

const router = Router()

function requirePlatformOwner(req: Request, res: Response, next: NextFunction): void {
  const authed = req as AuthenticatedRequest
  const platformTenantId = process.env['PLATFORM_TENANT_ID']
  if (!platformTenantId || authed.tenantId !== platformTenantId || authed.role !== 'owner') {
    res.status(403).json({ error: 'Not authorized' })
    return
  }
  next()
}

router.use(requireAuth, requirePlatformOwner)

// ── GET /api/admin-console/access-check ──────────────────────────────────────
// Used by the dashboard Sidebar to decide whether to render the nav link at
// all, without the client ever needing to know the platform tenant id.
router.get('/access-check', (_req: Request, res: Response): void => {
  res.json({ ok: true })
})

// ── GET /api/admin-console/tenants ───────────────────────────────────────────
router.get('/tenants', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from = (page - 1) * limit
  const to = from + limit - 1
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''

  let query = supabase
    .from('tenants')
    .select(
      'id, name, slug, vertical, product, subscription_plan, subscription_status, trial_ends_at, created_at, billing_email',
      { count: 'exact' }
    )

  if (q) {
    const pat = `%${q}%`
    query = query.or(`name.ilike.${pat},billing_email.ilike.${pat}`)
  }

  query = query.order('created_at', { ascending: false }).range(from, to)

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [], total: count ?? 0, page })
})

// ── GET /api/admin-console/tenants/:id ───────────────────────────────────────
router.get('/tenants/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('tenants')
    .select(
      'id, name, slug, vertical, product, subscription_plan, subscription_status, trial_ends_at, current_period_end, created_at, billing_email, modules, maya_minutes_used, maya_minutes_limit, stripe_customer_id'
    )
    .eq('id', req.params['id'])
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  // Never surface the raw Stripe customer id to the console UI — just
  // whether one exists (i.e. has the tenant ever reached checkout).
  const { stripe_customer_id, ...rest } = data
  res.json({ ...rest, has_stripe_customer: Boolean(stripe_customer_id) })
})

// ── GET /api/admin-console/tenants/:id/activity ──────────────────────────────
// Quick read-only debugging visibility into a tenant — recent activity feed
// plus rough counts, no session required. For anything beyond looking, use
// POST /tenants/:id/impersonate below instead.
router.get('/tenants/:id/activity', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const tenantId = req.params['id']!

  const { data: tenant } = await supabase.from('tenants').select('id').eq('id', tenantId).single()
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const [
    { count: contactCount },
    { count: appointmentCount },
    { count: dealCount },
    { count: callCount },
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase
      .from('voice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
  ])

  const { data: recentActivity, error } = await supabase
    .from('activity_log')
    .select('id, type, body, actor_type, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({
    counts: {
      contacts: contactCount ?? 0,
      appointments: appointmentCount ?? 0,
      deals: dealCount ?? 0,
      calls: callCount ?? 0,
    },
    recent_activity: recentActivity ?? [],
  })
})

// ── POST /api/admin-console/tenants/:id/impersonate ──────────────────────────
// Real "log in as this tenant" access — read-write, not the read-only
// drill-down above. Reason required; every session + every mutating request
// made during it is fingerprinted (impersonation_sessions/_actions).
router.post('/tenants/:id/impersonate', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { reason } = req.body as { reason?: string }
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: 'A reason is required to start an impersonation session' })
    return
  }

  const supabase = getServiceClient()

  // The platform admin's own email — not carried in the JWT claims, so
  // resolved here for the audit record.
  const { data: platformUser } = await supabase
    .from('users')
    .select('email')
    .eq('id', authed.appUserId)
    .maybeSingle<{ email: string | null }>()

  const result = await startImpersonationSession(supabase, {
    platformUserId: authed.appUserId ?? '',
    platformUserEmail: platformUser?.email ?? 'unknown',
    targetTenantId: req.params['id'] as string,
    reason: reason.trim(),
  })

  if ('error' in result) {
    res.status(400).json({ error: result.error })
    return
  }
  res.json(result)
})

// ── GET /api/admin-console/impersonate/sessions ──────────────────────────────
// The audit trail — which platform admin impersonated which tenant, when,
// and why. The "fingerprints" view. Manual batch-fetch-and-merge for the
// tenant name rather than a nested select — target_tenant_id doesn't follow
// the tenants(...) FK-name convention Supabase's embed resolution expects.
router.get('/impersonate/sessions', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('impersonation_sessions')
    .select('id, platform_user_email, target_tenant_id, reason, started_at, expires_at, ended_at')
    .order('started_at', { ascending: false })
    .limit(50)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = data ?? []
  const tenantIds = [...new Set(rows.map((s) => s.target_tenant_id as string))]
  let tenantNames: Record<string, string> = {}
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase.from('tenants').select('id, name').in('id', tenantIds)
    tenantNames = Object.fromEntries((tenants ?? []).map((t) => [t.id as string, t.name as string]))
  }

  res.json({
    sessions: rows.map((s) => ({
      ...s,
      tenant_name: tenantNames[s.target_tenant_id as string] ?? 'Unknown',
    })),
  })
})

// ── POST /api/admin-console/impersonate/:sessionId/end ───────────────────────
router.post('/impersonate/:sessionId/end', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const ended = await endImpersonationSession(
    supabase,
    req.params['sessionId'] as string,
    authed.appUserId ?? ''
  )
  res.json({ ended })
})

// ── GET /api/admin-console/summary ───────────────────────────────────────────
// Rough, estimated figures only — NOT reconciled with actual Stripe invoicing.
router.get('/summary', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('tenants')
    .select('subscription_status, subscription_plan')

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = data ?? []
  const byStatus: Record<string, number> = {}
  const byPlan: Record<string, number> = {}
  let estimatedMrrCents = 0

  for (const t of rows) {
    const status = (t.subscription_status as string | null) ?? 'unknown'
    byStatus[status] = (byStatus[status] ?? 0) + 1

    const plan = t.subscription_plan as PlanKey | null
    if (plan) {
      byPlan[plan] = (byPlan[plan] ?? 0) + 1
      if (status === 'active' && PLANS[plan]) {
        estimatedMrrCents += PLANS[plan].monthlyPrice
      }
    }
  }

  res.json({
    total_tenants: rows.length,
    by_status: byStatus,
    by_plan: byPlan,
    estimated_mrr_cents: estimatedMrrCents,
  })
})

// ── GET /api/admin-console/product-health ────────────────────────────────────
// Cross-tenant feature-adoption breakdown. Derived from tables features
// already write to on real use (a quote row, a clock-in row) — no new
// event-capture instrumentation, no new table. See lib/feature-usage.ts.
router.get('/product-health', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const windowDays = Math.min(90, Math.max(1, Number(req.query['windowDays']) || 30))

  try {
    const features = await getFeatureUsageSummary(supabase, windowDays)
    res.json({ window_days: windowDays, features })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute' })
  }
})

// ── GET /api/admin-console/trial-funnel ──────────────────────────────────────
// Where trial tenants land — still deciding, converted, or lapsed without
// ever adding a card. Keyed off tenants.trial_ends_at/subscription_status,
// the same fields trial-status.ts already uses to gate read-only access —
// no new tracking needed.
router.get('/trial-funnel', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('tenants')
    .select('id, subscription_status, trial_ends_at, product')

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const now = Date.now()
  let stillTrialing = 0
  let converted = 0
  let expiredNoConvert = 0
  let canceled = 0
  let paymentIssue = 0

  for (const t of data ?? []) {
    const status = (t.subscription_status as string | null) ?? ''
    const trialEndsAt = t.trial_ends_at as string | null

    if (CONVERTED_STATUSES.has(status)) {
      converted++
    } else if (CANCELED_STATUSES.has(status)) {
      canceled++
    } else if (TRIALING_STATUSES.has(status)) {
      const stillWithinTrial = !trialEndsAt || new Date(trialEndsAt).getTime() > now
      if (stillWithinTrial) stillTrialing++
      else expiredNoConvert++
    } else if (status) {
      // past_due / unpaid / paused / incomplete — decided-and-paying-at-some-
      // point but currently in a failure state, distinct from a clean cancel.
      paymentIssue++
    }
  }

  const decided = converted + expiredNoConvert + canceled + paymentIssue
  const conversionRate = decided > 0 ? Math.round((converted / decided) * 100) : 0

  res.json({
    still_trialing: stillTrialing,
    converted,
    expired_no_convert: expiredNoConvert,
    canceled,
    payment_issue: paymentIssue,
    conversion_rate: conversionRate,
  })
})

// ── GET /api/admin-console/referrals ─────────────────────────────────────────
// Cross-tenant view of Nuatis's own tenant-affiliate program — referring
// tenant, commission amount, and status. `active` = commission earned and
// computed, not yet paid; `paid` = paid out.
router.get('/referrals', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : ''

  let query = supabase
    .from('referral_signups')
    .select(
      'id, referring_tenant_id, referred_email, status, commission_amount, activated_at, paid_at'
    )
    .not('commission_amount', 'is', null)

  if (status) query = query.eq('status', status)
  query = query.order('activated_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = data ?? []
  const referringTenantIds = [...new Set(rows.map((r) => r.referring_tenant_id as string))]
  let tenantNames: Record<string, string> = {}
  if (referringTenantIds.length > 0) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name')
      .in('id', referringTenantIds)
    tenantNames = Object.fromEntries((tenants ?? []).map((t) => [t.id as string, t.name as string]))
  }

  res.json({
    data: rows.map((r) => ({
      ...r,
      referring_tenant_name: tenantNames[r.referring_tenant_id as string] ?? 'Unknown',
    })),
  })
})

// ── POST /api/admin-console/referrals/:id/mark-paid ──────────────────────────
router.post('/referrals/:id/mark-paid', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('referral_signups')
    .select('id, status')
    .eq('id', req.params['id'])
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (existing.status !== 'active') {
    res.status(409).json({ error: `Cannot mark a ${existing.status} referral as paid` })
    return
  }

  const { data, error } = await supabase
    .from('referral_signups')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to mark paid' })
    return
  }

  res.json(data)
})

// ── GET /api/admin-console/referral-codes ────────────────────────────────────
// Every tenant's own referral code + its reward structure — the thing a
// support rep sets up a custom fixed-dollar deal on (see PATCH below), rather
// than the default 20% commission.
router.get('/referral-codes', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('referral_codes')
    .select('id, tenant_id, code, status, commission_rate, reward_type, fixed_reward_cents')
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = data ?? []
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id as string))]
  let tenantNames: Record<string, string> = {}
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase.from('tenants').select('id, name').in('id', tenantIds)
    tenantNames = Object.fromEntries((tenants ?? []).map((t) => [t.id as string, t.name as string]))
  }

  res.json({
    data: rows.map((r) => ({ ...r, tenant_name: tenantNames[r.tenant_id as string] ?? 'Unknown' })),
  })
})

// ── PATCH /api/admin-console/referral-codes/:id ──────────────────────────────
// Sets a custom reward structure on one tenant's referral code — e.g. a flat
// $50/referral deal instead of the default 20% commission.
router.patch('/referral-codes/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const rewardType = b['reward_type']
  if (rewardType !== 'percent' && rewardType !== 'fixed') {
    res.status(400).json({ error: "reward_type must be 'percent' or 'fixed'" })
    return
  }

  const updates: Record<string, unknown> = { reward_type: rewardType }
  if (rewardType === 'fixed') {
    const cents = b['fixed_reward_cents']
    if (typeof cents !== 'number' || cents < 0) {
      res.status(400).json({ error: 'fixed_reward_cents must be a non-negative number' })
      return
    }
    updates['fixed_reward_cents'] = cents
  } else if (typeof b['commission_rate'] === 'number') {
    updates['commission_rate'] = b['commission_rate']
  }

  const { data, error } = await supabase
    .from('referral_codes')
    .update(updates)
    .eq('id', req.params['id'])
    .select('id, tenant_id, code, commission_rate, reward_type, fixed_reward_cents')
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json(data)
})

export default router
