import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// ── GET /api/settings/nps-surveys ────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('nps_survey_automation_enabled, nps_survey_delay_minutes')
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({
    enabled: tenant.nps_survey_automation_enabled ?? false,
    delayMinutes: tenant.nps_survey_delay_minutes ?? 120,
  })
})

// ── PATCH /api/settings/nps-surveys ──────────────────────────────────────────
router.patch('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  if (typeof b['enabled'] === 'boolean') {
    updates['nps_survey_automation_enabled'] = b['enabled']
  }

  if (typeof b['delayMinutes'] === 'number') {
    const delay = Math.round(b['delayMinutes'])
    if (delay < 15 || delay > 1440) {
      res.status(400).json({ error: 'delayMinutes must be between 15 and 1440' })
      return
    }
    updates['nps_survey_delay_minutes'] = delay
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
    .select('nps_survey_automation_enabled, nps_survey_delay_minutes')
    .eq('id', authed.tenantId)
    .single()

  res.json({
    enabled: tenant?.nps_survey_automation_enabled ?? false,
    delayMinutes: tenant?.nps_survey_delay_minutes ?? 120,
  })
})

export default router
