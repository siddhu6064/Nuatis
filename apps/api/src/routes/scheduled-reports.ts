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

const VALID_REPORT_TYPES = ['velocity', 'appointments', 'lead_source', 'pipeline_funnel']
const VALID_FREQUENCIES = ['weekly', 'monthly']

// ── GET /api/scheduled-reports ───────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('scheduled_reports')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ data: data ?? [] })
})

// ── POST /api/scheduled-reports ──────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const body = req.body as {
    report_type?: string
    frequency?: string
    day_of_week?: number
    day_of_month?: number
    recipients?: string[]
  }

  if (!body.report_type || !VALID_REPORT_TYPES.includes(body.report_type)) {
    res.status(400).json({ error: `report_type must be one of: ${VALID_REPORT_TYPES.join(', ')}` })
    return
  }
  if (!body.frequency || !VALID_FREQUENCIES.includes(body.frequency)) {
    res.status(400).json({ error: 'frequency must be weekly or monthly' })
    return
  }
  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    res.status(400).json({ error: 'recipients must be a non-empty array of email addresses' })
    return
  }
  if (body.frequency === 'weekly') {
    if (body.day_of_week === undefined || body.day_of_week < 0 || body.day_of_week > 6) {
      res.status(400).json({ error: 'day_of_week (0-6) required for weekly frequency' })
      return
    }
  }
  if (body.frequency === 'monthly') {
    if (body.day_of_month === undefined || body.day_of_month < 1 || body.day_of_month > 28) {
      res.status(400).json({ error: 'day_of_month (1-28) required for monthly frequency' })
      return
    }
  }

  const { data, error } = await supabase
    .from('scheduled_reports')
    .insert({
      tenant_id: authed.tenantId,
      report_type: body.report_type,
      frequency: body.frequency,
      day_of_week: body.day_of_week ?? null,
      day_of_month: body.day_of_month ?? null,
      recipients: body.recipients,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json({ data })
})

// ── PATCH /api/scheduled-reports/:id ────────────────────────────────────────
router.patch('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const body = req.body as {
    enabled?: boolean
    frequency?: string
    day_of_week?: number
    day_of_month?: number
    recipients?: string[]
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') updates['enabled'] = body.enabled
  if (body.frequency && VALID_FREQUENCIES.includes(body.frequency))
    updates['frequency'] = body.frequency
  if (body.day_of_week !== undefined) updates['day_of_week'] = body.day_of_week
  if (body.day_of_month !== undefined) updates['day_of_month'] = body.day_of_month
  if (Array.isArray(body.recipients) && body.recipients.length > 0)
    updates['recipients'] = body.recipients

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  const { data, error } = await supabase
    .from('scheduled_reports')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error || !data) {
    res.status(error ? 500 : 404).json({ error: error?.message ?? 'Not found' })
    return
  }

  res.json({ data })
})

// ── DELETE /api/scheduled-reports/:id ───────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { error } = await supabase
    .from('scheduled_reports')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(204).send()
})

export default router
