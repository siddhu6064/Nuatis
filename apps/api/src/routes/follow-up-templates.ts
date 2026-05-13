import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { VERTICALS } from '@nuatis/shared'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface MergedStep {
  step_index: number
  days_after: number
  channel: 'sms' | 'email'
  body: string
  subject?: string
  is_enabled: boolean
  is_customized: boolean
}

function getDefaultCadence(vertical: string) {
  const slug = (vertical || 'sales_crm') as keyof typeof VERTICALS
  const config = VERTICALS[slug] ?? VERTICALS['sales_crm']
  return (config?.follow_up_cadence ?? []) as Array<{
    days_after: number
    channel: 'sms' | 'email'
    template: string
    subject?: string
  }>
}

function mergeSteps(
  defaults: ReturnType<typeof getDefaultCadence>,
  overrides: Array<{
    step_index: number
    channel: string
    body: string
    subject: string | null
    is_enabled: boolean
  }>
): MergedStep[] {
  const overrideMap = new Map(overrides.map((o) => [`${o.step_index}:${o.channel}`, o]))

  return defaults.map((step, i) => {
    const key = `${i}:${step.channel}`
    const override = overrideMap.get(key)
    return {
      step_index: i,
      days_after: step.days_after,
      channel: step.channel,
      body: override?.body ?? step.template,
      subject: override?.subject ?? step.subject,
      is_enabled: override?.is_enabled ?? true,
      is_customized: !!override,
    }
  })
}

// GET /api/follow-up-templates
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const defaults = getDefaultCadence(authed.vertical)

  const { data: overrides, error } = await supabase
    .from('tenant_follow_up_overrides')
    .select('step_index, channel, body, subject, is_enabled')
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: 'Failed to fetch overrides' })
    return
  }

  res.json({ steps: mergeSteps(defaults, overrides ?? []) })
})

// PUT /api/follow-up-templates
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { steps } = req.body as {
    steps: Array<{
      step_index: number
      channel: 'sms' | 'email'
      body: string
      subject?: string
      is_enabled: boolean
    }>
  }

  if (!Array.isArray(steps)) {
    res.status(400).json({ error: 'steps must be an array' })
    return
  }

  // Validate SMS STOP language
  for (const step of steps) {
    if (step.channel === 'sms' && !step.body.toUpperCase().includes('STOP')) {
      res.status(400).json({
        error: `Step ${step.step_index} SMS body must include STOP opt-out language (e.g. "Reply STOP to opt out.")`,
      })
      return
    }
  }

  const rows = steps.map((step) => ({
    tenant_id: authed.tenantId,
    step_index: step.step_index,
    channel: step.channel,
    body: step.body,
    subject: step.subject ?? null,
    is_enabled: step.is_enabled,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('tenant_follow_up_overrides')
    .upsert(rows, { onConflict: 'tenant_id,step_index,channel' })

  if (error) {
    res.status(500).json({ error: 'Failed to save overrides' })
    return
  }

  // Return merged steps
  const defaults = getDefaultCadence(authed.vertical)
  const { data: overrides } = await supabase
    .from('tenant_follow_up_overrides')
    .select('step_index, channel, body, subject, is_enabled')
    .eq('tenant_id', authed.tenantId)

  res.json({ steps: mergeSteps(defaults, overrides ?? []) })
})

export default router
