import { Router, type Request, type Response } from 'express'
import { nanoid } from 'nanoid'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'

const router = Router()

// Phase 9: subscription + module gate. 'automation' is in Pro + Scale.
router.use(requireAuth, requirePlan('automation'))

const VALID_TRIGGER_TYPES = [
  'no_response',
  'birthday',
  'overdue_invoice',
  'inactive_customer',
  'new_contact',
  'appointment_followup',
  'inbound_webhook',
] as const

const WEBHOOK_MATCH_FIELDS = ['email', 'phone'] as const
const WEBHOOK_MAPPING_KEYS = ['email', 'phone', 'first_name', 'last_name'] as const

// Manually configured, not AI-generated — the LLM can't know an external
// system's payload shape. field_mapping keys are Nuatis contact fields, values
// are the flat top-level JSON key to read from the incoming webhook body.
function validateWebhookTriggerConfig(config: unknown): string | null {
  const c = (config ?? {}) as Record<string, unknown>
  const matchBy = c['match_by']
  if (!(WEBHOOK_MATCH_FIELDS as readonly string[]).includes(matchBy as string)) {
    return `trigger_config.match_by must be one of: ${WEBHOOK_MATCH_FIELDS.join(', ')}`
  }
  const mapping = c['field_mapping']
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return 'trigger_config.field_mapping is required'
  }
  const mappingObj = mapping as Record<string, unknown>
  for (const key of Object.keys(mappingObj)) {
    if (!(WEBHOOK_MAPPING_KEYS as readonly string[]).includes(key)) {
      return `trigger_config.field_mapping keys must be one of: ${WEBHOOK_MAPPING_KEYS.join(', ')}`
    }
    if (typeof mappingObj[key] !== 'string' || !(mappingObj[key] as string).trim()) {
      return `trigger_config.field_mapping.${key} must be a non-empty payload key`
    }
  }
  if (!mappingObj[matchBy as string]) {
    return `trigger_config.field_mapping must include a mapping for the match_by field (${matchBy})`
  }
  return null
}

async function generateInboundWebhookToken(
  supabase: ReturnType<typeof getServiceClient>
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const token = nanoid(32)
    const { data } = await supabase
      .from('custom_automations')
      .select('id')
      .eq('inbound_webhook_token', token)
      .maybeSingle()
    if (!data) return token
  }
  throw new Error('Failed to generate unique webhook token after 5 attempts')
}

const VALID_ACTION_TYPES = [
  'send_sms',
  'send_email',
  'create_task',
  'add_tag',
  'update_field',
  'send_to_campaign',
  'send_webhook',
] as const

// ── POST /api/custom-automations/generate ────────────────────────────────────
router.post('/generate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { prompt, businessName, vertical } = req.body as {
    prompt?: string
    businessName?: string
    vertical?: string
  }

  if (!prompt?.trim()) {
    res.status(400).json({ error: 'prompt is required' })
    return
  }

  try {
    const { generateAutomationConfig } = await import('../lib/automation-ai-builder.js')
    const result = await generateAutomationConfig({
      naturalLanguagePrompt: prompt,
      tenantId: authed.tenantId,
      businessName,
      vertical,
    })
    res.json({ automation: result })
  } catch (err) {
    console.error('[custom-automations] generate error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/custom-automations ───────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  try {
    const { data, error } = await supabase
      .from('custom_automations')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: 'Failed to fetch automations' })
      return
    }

    res.json({ automations: data ?? [] })
  } catch (err) {
    console.error('[custom-automations] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/custom-automations ─────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const {
    name,
    description,
    natural_language_prompt,
    trigger_type,
    trigger_config,
    action_type,
    action_config,
  } = req.body as {
    name?: string
    description?: string
    natural_language_prompt?: string
    trigger_type?: string
    trigger_config?: unknown
    action_type?: string
    action_config?: unknown
  }

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!trigger_type?.trim()) {
    res.status(400).json({ error: 'trigger_type is required' })
    return
  }
  if (!action_type?.trim()) {
    res.status(400).json({ error: 'action_type is required' })
    return
  }

  if (!(VALID_TRIGGER_TYPES as readonly string[]).includes(trigger_type)) {
    res.status(400).json({
      error: `trigger_type must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
    })
    return
  }

  if (!(VALID_ACTION_TYPES as readonly string[]).includes(action_type)) {
    res.status(400).json({
      error: `action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}`,
    })
    return
  }

  const isWebhookTrigger = trigger_type === 'inbound_webhook'

  // Every other trigger goes through the AI builder, which always produces a
  // prompt; a webhook trigger is manually configured (no AI involved, since
  // the AI can't know an external system's payload shape) so it has none.
  if (!isWebhookTrigger && !natural_language_prompt?.trim()) {
    res.status(400).json({ error: 'natural_language_prompt is required' })
    return
  }

  if (isWebhookTrigger) {
    const configErr = validateWebhookTriggerConfig(trigger_config)
    if (configErr) {
      res.status(400).json({ error: configErr })
      return
    }
  }

  const supabase = getServiceClient()

  try {
    let webhookToken: string | null = null
    if (isWebhookTrigger) {
      try {
        webhookToken = await generateInboundWebhookToken(supabase)
      } catch (err) {
        console.error('[custom-automations] webhook token generation failed:', err)
        res.status(500).json({ error: 'Failed to generate webhook token' })
        return
      }
    }

    const { data, error } = await supabase
      .from('custom_automations')
      .insert({
        tenant_id: authed.tenantId,
        name: name.trim(),
        description: description ?? null,
        natural_language_prompt: isWebhookTrigger
          ? 'Triggered by an inbound webhook (manually configured)'
          : natural_language_prompt!.trim(),
        trigger_type,
        trigger_config: trigger_config ?? null,
        action_type,
        action_config: action_config ?? null,
        status: 'draft',
        inbound_webhook_token: webhookToken,
      })
      .select('*')
      .single()

    if (error) {
      console.error('[custom-automations] insert error:', error.message)
      res.status(500).json({ error: 'Failed to create automation' })
      return
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('[custom-automations] POST error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PATCH /api/custom-automations/:id ────────────────────────────────────────
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()

  try {
    const { data: existing } = await supabase
      .from('custom_automations')
      .select('id, trigger_type')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!existing) {
      res.status(404).json({ error: 'Automation not found' })
      return
    }

    const { name, description, natural_language_prompt, trigger_config, action_config } =
      req.body as {
        name?: string
        description?: string
        natural_language_prompt?: string
        trigger_config?: unknown
        action_config?: unknown
      }

    if (trigger_config !== undefined && existing.trigger_type === 'inbound_webhook') {
      const configErr = validateWebhookTriggerConfig(trigger_config)
      if (configErr) {
        res.status(400).json({ error: configErr })
        return
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates['name'] = name
    if (description !== undefined) updates['description'] = description
    if (natural_language_prompt !== undefined)
      updates['natural_language_prompt'] = natural_language_prompt
    if (trigger_config !== undefined) updates['trigger_config'] = trigger_config
    if (action_config !== undefined) updates['action_config'] = action_config

    const { data, error } = await supabase
      .from('custom_automations')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (error) {
      console.error('[custom-automations] update error:', error.message)
      res.status(500).json({ error: 'Failed to update automation' })
      return
    }

    res.json(data)
  } catch (err) {
    console.error('[custom-automations] PATCH error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/custom-automations/:id ───────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()

  try {
    const { data: existing } = await supabase
      .from('custom_automations')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!existing) {
      res.status(404).json({ error: 'Automation not found' })
      return
    }

    const { error } = await supabase
      .from('custom_automations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)

    if (error) {
      console.error('[custom-automations] delete error:', error.message)
      res.status(500).json({ error: 'Failed to delete automation' })
      return
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[custom-automations] DELETE error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/custom-automations/:id/activate ────────────────────────────────
router.post('/:id/activate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()

  try {
    const { data: existing } = await supabase
      .from('custom_automations')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!existing) {
      res.status(404).json({ error: 'Automation not found' })
      return
    }

    const { error } = await supabase
      .from('custom_automations')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)

    if (error) {
      console.error('[custom-automations] activate error:', error.message)
      res.status(500).json({ error: 'Failed to activate automation' })
      return
    }

    res.json({ status: 'active' })
  } catch (err) {
    console.error('[custom-automations] activate error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/custom-automations/:id/pause ───────────────────────────────────
router.post('/:id/pause', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()

  try {
    const { data: existing } = await supabase
      .from('custom_automations')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!existing) {
      res.status(404).json({ error: 'Automation not found' })
      return
    }

    const { error } = await supabase
      .from('custom_automations')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)

    if (error) {
      console.error('[custom-automations] pause error:', error.message)
      res.status(500).json({ error: 'Failed to pause automation' })
      return
    }

    res.json({ status: 'paused' })
  } catch (err) {
    console.error('[custom-automations] pause error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const CONDITION_OPS = ['eq', 'neq', 'contains', 'exists'] as const

interface StepInput {
  action_type: string
  action_config?: Record<string, unknown>
  delay_days?: number
  condition_field?: string | null
  condition_op?: (typeof CONDITION_OPS)[number] | null
  condition_value?: string | null
}

function validateAutomationSteps(steps: unknown[]): string | null {
  for (const s of steps) {
    const step = s as Record<string, unknown>
    if (!(VALID_ACTION_TYPES as readonly string[]).includes(step['action_type'] as string)) {
      return `Each step's action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}`
    }
    if (
      step['condition_op'] !== undefined &&
      step['condition_op'] !== null &&
      !(CONDITION_OPS as readonly string[]).includes(step['condition_op'] as string)
    ) {
      return `condition_op must be one of: ${CONDITION_OPS.join(', ')}`
    }
  }
  return null
}

// ── GET /api/custom-automations/:id/steps ────────────────────────────────────
// Extra steps after the AI-generated base action — a manually-built surface,
// unlike the trigger/action above (see automation-ai-builder.ts).
router.get('/:id/steps', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()

  const { data: automation } = await supabase
    .from('custom_automations')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!automation) {
    res.status(404).json({ error: 'Automation not found' })
    return
  }

  const { data, error } = await supabase
    .from('custom_automation_steps')
    .select('*')
    .eq('automation_id', id)
    .order('step_order', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ steps: data ?? [] })
})

// ── PUT /api/custom-automations/:id/steps ────────────────────────────────────
// Replaces the full step list (delete-then-reinsert), same pattern used for
// deal/quote line items elsewhere in this codebase.
router.put('/:id/steps', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const { data: automation } = await supabase
    .from('custom_automations')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!automation) {
    res.status(404).json({ error: 'Automation not found' })
    return
  }

  const steps = Array.isArray(b['steps']) ? (b['steps'] as StepInput[]) : []
  const stepsErr = validateAutomationSteps(steps)
  if (stepsErr) {
    res.status(400).json({ error: stepsErr })
    return
  }

  await supabase.from('custom_automation_steps').delete().eq('automation_id', id)

  if (steps.length === 0) {
    res.json({ steps: [] })
    return
  }

  const rows = steps.map((s, i) => ({
    automation_id: id,
    tenant_id: authed.tenantId,
    step_order: i + 1,
    delay_days: s.delay_days ?? 0,
    action_type: s.action_type,
    action_config: s.action_config ?? {},
    condition_field: s.condition_field?.trim() || null,
    condition_op: s.condition_field?.trim() ? (s.condition_op ?? 'exists') : null,
    condition_value: s.condition_field?.trim() ? (s.condition_value ?? null) : null,
  }))

  const { data: inserted, error: insertErr } = await supabase
    .from('custom_automation_steps')
    .insert(rows)
    .select('*')

  if (insertErr) {
    res.status(500).json({ error: `Steps failed to save: ${insertErr.message}` })
    return
  }

  res.json({ steps: inserted ?? [] })
})

export default router
