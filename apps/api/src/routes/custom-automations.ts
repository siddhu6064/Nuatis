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

const VALID_TRIGGER_TYPES = [
  'no_response',
  'birthday',
  'overdue_invoice',
  'inactive_customer',
  'new_contact',
  'appointment_followup',
] as const

const VALID_ACTION_TYPES = [
  'send_sms',
  'send_email',
  'create_task',
  'add_tag',
  'update_field',
  'send_to_campaign',
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
  const supabase = getSupabase()

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
  if (!natural_language_prompt?.trim()) {
    res.status(400).json({ error: 'natural_language_prompt is required' })
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

  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('custom_automations')
      .insert({
        tenant_id: authed.tenantId,
        name: name.trim(),
        description: description ?? null,
        natural_language_prompt: natural_language_prompt.trim(),
        trigger_type,
        trigger_config: trigger_config ?? null,
        action_type,
        action_config: action_config ?? null,
        status: 'draft',
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
  const supabase = getSupabase()

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

    const { name, description, natural_language_prompt, trigger_config, action_config } =
      req.body as {
        name?: string
        description?: string
        natural_language_prompt?: string
        trigger_config?: unknown
        action_config?: unknown
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
  const supabase = getSupabase()

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
  const supabase = getSupabase()

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
  const supabase = getSupabase()

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

export default router
