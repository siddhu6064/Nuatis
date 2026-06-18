import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { PLANS, PLAN_KEYS, BASE_SUITE, type PlanKey } from '../config/stripe-plans.js'
import { VALID_MODULE_IDS } from '../config/module-registry.js'

const router = Router()

const VALID_MODULES = VALID_MODULE_IDS

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/settings/modules ───────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('tenants')
    .select('modules')
    .eq('id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({ modules: (data.modules as Record<string, boolean>) ?? {} })
})

// ── PUT /api/settings/modules ───────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  if (authed.role !== 'owner') {
    res.status(403).json({ error: 'Only workspace owners can change module settings' })
    return
  }

  const b = req.body as Record<string, unknown>
  const moduleName = typeof b['module'] === 'string' ? b['module'] : ''
  const enabled = typeof b['enabled'] === 'boolean' ? b['enabled'] : null

  if (!VALID_MODULES.includes(moduleName)) {
    res.status(400).json({ error: `Invalid module. Valid: ${VALID_MODULES.join(', ')}` })
    return
  }
  if (enabled === null) {
    res.status(400).json({ error: 'enabled must be a boolean' })
    return
  }

  // Fetch current tenant row — includes the plan field needed for the gate below.
  const { data: current, error: currentError } = await supabase
    .from('tenants')
    .select('modules, subscription_plan')
    .eq('id', authed.tenantId)
    .single()

  // ── Plan gate ─────────────────────────────────────────────────────────────
  // Only runs when *enabling* a module — disabling is always permitted so
  // owners can freely turn off features they no longer need.
  //
  // Fails CLOSED on every uncertain path: trial tenants are gated by their
  // plan like paying tenants; a null/unknown plan permits only BASE_SUITE
  // modules; lookup errors deny rather than allow. Comp overrides are
  // unaffected — admin/service-role writes bypass this endpoint entirely and
  // already-stored explicit `true` values are never touched here.
  if (enabled === true) {
    if (currentError || !current) {
      console.error(
        '[settings-modules] tenant lookup failed — failing closed:',
        currentError?.message ?? 'tenant not found'
      )
      res.status(503).json({ error: 'Cannot verify entitlement. Try again shortly.' })
      return
    }

    try {
      const subscriptionPlan = (current.subscription_plan as string | null | undefined) ?? null
      const plan = subscriptionPlan ? (PLANS[subscriptionPlan as PlanKey] ?? null) : null

      // Known plan → its module list decides. Null/unknown plan → base suite only.
      const allowed = plan
        ? (plan.modules as ReadonlyArray<string>).includes(moduleName)
        : BASE_SUITE.has(moduleName)

      if (!allowed) {
        // Identify the lowest tier that includes the requested module.
        const requiredPlan =
          PLAN_KEYS.find((k) => (PLANS[k].modules as ReadonlyArray<string>).includes(moduleName)) ??
          null

        res.status(402).json({
          error: 'Plan upgrade required to enable this module',
          module: moduleName,
          current_plan: subscriptionPlan,
          required_plan: requiredPlan,
          upgrade_url: '/pricing',
        })
        return
      }
    } catch (error) {
      console.error('[settings-modules] plan check failed — failing closed:', error)
      res.status(503).json({ error: 'Cannot verify entitlement. Try again shortly.' })
      return
    }
  }

  const currentModules = (current?.modules as Record<string, boolean>) ?? {}
  const updated = { ...currentModules, [moduleName]: enabled }

  const { error } = await supabase
    .from('tenants')
    .update({ modules: updated })
    .eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[settings-modules] ${moduleName}=${enabled} for tenant=${authed.tenantId}`)
  res.json({ modules: updated })
})

export default router
