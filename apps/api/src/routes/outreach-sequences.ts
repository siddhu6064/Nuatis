import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlan } from '../middleware/require-plan.js'

const router = Router()
router.use(requireAuth, requirePlan('automation'))

const CHANNELS = ['sms', 'email'] as const
type Channel = (typeof CHANNELS)[number]

interface StepInput {
  channel: Channel
  days_after: number
  template: string
  subject?: string
}

function validateSteps(steps: unknown[]): string | null {
  if (steps.length === 0) return 'At least one step is required'
  for (const s of steps) {
    const step = s as Record<string, unknown>
    if (!CHANNELS.includes(step['channel'] as Channel)) {
      return `Each step's channel must be one of: ${CHANNELS.join(', ')}`
    }
    if (typeof step['days_after'] !== 'number' || step['days_after'] < 0) {
      return 'Each step needs days_after >= 0'
    }
    if (typeof step['template'] !== 'string' || !step['template'].trim()) {
      return 'Each step needs a template'
    }
  }
  return null
}

// ── GET /api/outreach-sequences ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: sequences, error } = await supabase
    .from('outreach_sequences')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const sequenceIds = (sequences ?? []).map((s) => s.id as string)
  const { data: steps } = await supabase
    .from('outreach_sequence_steps')
    .select('id, sequence_id, step_order, days_after, channel, subject, template')
    .in('sequence_id', sequenceIds.length > 0 ? sequenceIds : ['__none__'])
    .order('step_order', { ascending: true })

  const { data: enrollments } = await supabase
    .from('outreach_sequence_enrollments')
    .select('sequence_id, status')
    .eq('tenant_id', authed.tenantId)
    .in('sequence_id', sequenceIds.length > 0 ? sequenceIds : ['__none__'])

  const data = (sequences ?? []).map((seq) => ({
    ...seq,
    steps: (steps ?? []).filter((s) => s.sequence_id === seq.id),
    active_enrollments: (enrollments ?? []).filter(
      (e) => e.sequence_id === seq.id && e.status === 'active'
    ).length,
  }))

  res.json({ data })
})

// ── POST /api/outreach-sequences ────────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const steps = Array.isArray(b['steps']) ? (b['steps'] as StepInput[]) : []
  const stepsErr = validateSteps(steps)
  if (stepsErr) {
    res.status(400).json({ error: stepsErr })
    return
  }

  const { data: sequence, error } = await supabase
    .from('outreach_sequences')
    .insert({ tenant_id: authed.tenantId, name })
    .select('*')
    .single()

  if (error || !sequence) {
    res.status(500).json({ error: error?.message ?? 'Failed to create sequence' })
    return
  }

  const stepRows = steps.map((s, i) => ({
    sequence_id: sequence.id,
    tenant_id: authed.tenantId,
    step_order: i,
    days_after: s.days_after,
    channel: s.channel,
    subject: s.subject?.trim() || null,
    template: s.template.trim(),
  }))
  const { data: insertedSteps, error: stepsInsertErr } = await supabase
    .from('outreach_sequence_steps')
    .insert(stepRows)
    .select('*')

  if (stepsInsertErr) {
    res.status(500).json({
      error: `Sequence created, but steps failed to save: ${stepsInsertErr.message}`,
    })
    return
  }

  res.status(201).json({ ...sequence, steps: insertedSteps ?? [] })
})

// ── PUT /api/outreach-sequences/:id ─────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('outreach_sequences')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!existing) {
    res.status(404).json({ error: 'Sequence not found' })
    return
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b['name'] === 'string' && b['name'].trim()) updates['name'] = b['name'].trim()
  if (typeof b['enabled'] === 'boolean') updates['enabled'] = b['enabled']

  const { data: sequence, error } = await supabase
    .from('outreach_sequences')
    .update(updates)
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('*')
    .single()

  if (error || !sequence) {
    res.status(500).json({ error: error?.message ?? 'Failed to update sequence' })
    return
  }

  let steps: unknown[] | undefined
  if (Array.isArray(b['steps'])) {
    const newSteps = b['steps'] as StepInput[]
    const stepsErr = validateSteps(newSteps)
    if (stepsErr) {
      res.status(400).json({ error: stepsErr })
      return
    }
    await supabase.from('outreach_sequence_steps').delete().eq('sequence_id', req.params['id'])
    const stepRows = newSteps.map((s, i) => ({
      sequence_id: req.params['id'],
      tenant_id: authed.tenantId,
      step_order: i,
      days_after: s.days_after,
      channel: s.channel,
      subject: s.subject?.trim() || null,
      template: s.template.trim(),
    }))
    const { data: insertedSteps, error: stepsInsertErr } = await supabase
      .from('outreach_sequence_steps')
      .insert(stepRows)
      .select('*')
    if (stepsInsertErr) {
      res.status(500).json({
        error: `Sequence updated, but steps failed to save: ${stepsInsertErr.message}`,
      })
      return
    }
    steps = insertedSteps ?? []
  }

  res.json({ ...sequence, ...(steps !== undefined ? { steps } : {}) })
})

// ── DELETE /api/outreach-sequences/:id ──────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('outreach_sequences')
    .delete()
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .select('id')
    .maybeSingle()

  if (error || !data) {
    res.status(404).json({ error: 'Sequence not found' })
    return
  }

  res.json({ success: true })
})

// ── GET /api/outreach-sequences/:id/enrollments ─────────────────────────────
router.get('/:id/enrollments', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('outreach_sequence_enrollments')
    .select('*, contacts(id, full_name, phone, email)')
    .eq('sequence_id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .order('enrolled_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/outreach-sequences/:id/enroll ─────────────────────────────────
router.post('/:id/enroll', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const b = req.body as Record<string, unknown>

  const contactIds = Array.isArray(b['contact_ids'])
    ? (b['contact_ids'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : typeof b['contact_id'] === 'string'
      ? [b['contact_id']]
      : []

  if (contactIds.length === 0) {
    res.status(400).json({ error: 'contact_id or contact_ids is required' })
    return
  }

  const { data: sequence } = await supabase
    .from('outreach_sequences')
    .select('id')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .maybeSingle()
  if (!sequence) {
    res.status(404).json({ error: 'Sequence not found' })
    return
  }

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('tenant_id', authed.tenantId)
    .in('id', contactIds)
  const validContactIds = new Set((contacts ?? []).map((c) => c.id as string))

  const results: { contact_id: string; enrolled: boolean }[] = []
  for (const contactId of contactIds) {
    if (!validContactIds.has(contactId)) {
      results.push({ contact_id: contactId, enrolled: false })
      continue
    }
    const { data: existingEnrollment } = await supabase
      .from('outreach_sequence_enrollments')
      .select('id, status')
      .eq('sequence_id', req.params['id'])
      .eq('contact_id', contactId)
      .maybeSingle()

    if (existingEnrollment) {
      await supabase
        .from('outreach_sequence_enrollments')
        .update({ status: 'active', current_step: 0, last_sent_at: null })
        .eq('id', existingEnrollment.id)
    } else {
      await supabase.from('outreach_sequence_enrollments').insert({
        tenant_id: authed.tenantId,
        sequence_id: req.params['id'],
        contact_id: contactId,
        status: 'active',
        current_step: 0,
      })
    }
    results.push({ contact_id: contactId, enrolled: true })
  }

  res.status(201).json({ results })
})

// ── POST /api/outreach-sequences/:id/enrollments/:enrollmentId/stop ────────
router.post(
  '/:id/enrollments/:enrollmentId/stop',
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('outreach_sequence_enrollments')
      .update({ status: 'stopped' })
      .eq('id', req.params['enrollmentId'])
      .eq('sequence_id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('id')
      .maybeSingle()

    if (error || !data) {
      res.status(404).json({ error: 'Enrollment not found' })
      return
    }

    res.json({ success: true })
  }
)

export default router
