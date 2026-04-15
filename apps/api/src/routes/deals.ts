import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { logActivity } from '../lib/activity.js'
import type { NextFunction } from 'express'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function requireDeals(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'deals')
  if (!enabled) {
    res.status(403).json({ error: 'Deals module is not enabled' })
    return
  }
  next()
}

// ── GET /api/deals ───────────────────────────────────────────────────────────
router.get('/', requireAuth, requireDeals, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  let query = supabase
    .from('deals')
    .select('*, pipeline_stages(id, name, color), contacts(id, full_name), companies(id, name)', {
      count: 'exact',
    })
    .eq('tenant_id', authed.tenantId)

  const archived = req.query['archived'] === 'true'
  if (!archived) query = query.eq('is_archived', false)

  const stageIds =
    typeof req.query['pipeline_stage_id'] === 'string'
      ? req.query['pipeline_stage_id'].split(',').filter(Boolean)
      : null
  if (stageIds && stageIds.length > 0) query = query.in('pipeline_stage_id', stageIds)

  const contactId = typeof req.query['contact_id'] === 'string' ? req.query['contact_id'] : null
  if (contactId) query = query.eq('contact_id', contactId)

  const companyId = typeof req.query['company_id'] === 'string' ? req.query['company_id'] : null
  if (companyId) query = query.eq('company_id', companyId)

  if (req.query['is_closed_won'] === 'true') query = query.eq('is_closed_won', true)
  if (req.query['is_closed_lost'] === 'true') query = query.eq('is_closed_lost', true)

  const closeDateFrom =
    typeof req.query['close_date_from'] === 'string' ? req.query['close_date_from'] : null
  const closeDateTo =
    typeof req.query['close_date_to'] === 'string' ? req.query['close_date_to'] : null
  if (closeDateFrom) query = query.gte('close_date', closeDateFrom)
  if (closeDateTo) query = query.lte('close_date', closeDateTo)

  const sortBy = req.query['sort_by'] === 'close_date' ? 'close_date' : 'updated_at'
  query = query.order(sortBy, { ascending: false, nullsFirst: false })

  const { data, error, count } = await query
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const deals = (data ?? []).map((d) => ({
    ...d,
    stage_name: (d.pipeline_stages as { name: string } | null)?.name ?? null,
    stage_color: (d.pipeline_stages as { color: string } | null)?.color ?? null,
    contact_name: (d.contacts as { full_name: string } | null)?.full_name ?? null,
    company_name: (d.companies as { name: string } | null)?.name ?? null,
  }))

  res.json({ deals, total: count ?? 0 })
})

// ── GET /api/deals/:id ───────────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: deal, error } = await supabase
      .from('deals')
      .select(
        '*, pipeline_stages(id, name, color), contacts(id, full_name, phone, email), companies(id, name, domain)'
      )
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !deal) {
      res.status(404).json({ error: 'Deal not found' })
      return
    }

    res.json({
      ...deal,
      stage_name: (deal.pipeline_stages as { name: string } | null)?.name ?? null,
      stage_color: (deal.pipeline_stages as { color: string } | null)?.color ?? null,
      contact_name: (deal.contacts as { full_name: string } | null)?.full_name ?? null,
      company_name: (deal.companies as { name: string } | null)?.name ?? null,
    })
  }
)

// ── POST /api/deals ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireDeals, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const title = typeof b['title'] === 'string' ? b['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const value = typeof b['value'] === 'number' ? b['value'] : 0
  const contactId = typeof b['contact_id'] === 'string' ? b['contact_id'] : null
  const companyId = typeof b['company_id'] === 'string' ? b['company_id'] : null
  const stageId = typeof b['pipeline_stage_id'] === 'string' ? b['pipeline_stage_id'] : null
  const closeDate = typeof b['close_date'] === 'string' ? b['close_date'] : null
  const probability = typeof b['probability'] === 'number' ? b['probability'] : 50
  const notes = typeof b['notes'] === 'string' ? b['notes'] : null

  const { data: deal, error } = await supabase
    .from('deals')
    .insert({
      tenant_id: authed.tenantId,
      contact_id: contactId,
      company_id: companyId,
      title,
      value,
      pipeline_stage_id: stageId,
      close_date: closeDate,
      probability,
      notes,
      created_by_user_id: authed.userId,
    })
    .select('*, pipeline_stages(id, name, color), contacts(id, full_name), companies(id, name)')
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  void logActivity({
    tenantId: authed.tenantId,
    contactId: contactId ?? undefined,
    type: 'system',
    body: `Deal created: "${title}" — $${Number(value).toFixed(2)}`,
    actorType: 'user',
    actorId: authed.userId,
  })

  res.status(201).json({
    ...deal,
    stage_name: (deal.pipeline_stages as { name: string } | null)?.name ?? null,
    stage_color: (deal.pipeline_stages as { color: string } | null)?.color ?? null,
    contact_name: (deal.contacts as { full_name: string } | null)?.full_name ?? null,
    company_name: (deal.companies as { name: string } | null)?.name ?? null,
  })
})

// ── PUT /api/deals/:id ───────────────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    const { data: existing } = await supabase
      .from('deals')
      .select('*, pipeline_stages(name)')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Deal not found' })
      return
    }

    const updates: Record<string, unknown> = {}
    if (typeof b['title'] === 'string') updates['title'] = b['title'].trim()
    if (typeof b['value'] === 'number') updates['value'] = b['value']
    if (typeof b['contact_id'] === 'string') updates['contact_id'] = b['contact_id']
    if (b['contact_id'] === null) updates['contact_id'] = null
    if (typeof b['company_id'] === 'string') updates['company_id'] = b['company_id']
    if (b['company_id'] === null) updates['company_id'] = null
    if (typeof b['pipeline_stage_id'] === 'string')
      updates['pipeline_stage_id'] = b['pipeline_stage_id']
    if (typeof b['close_date'] === 'string') updates['close_date'] = b['close_date']
    if (b['close_date'] === null) updates['close_date'] = null
    if (typeof b['probability'] === 'number') updates['probability'] = b['probability']
    if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
    if (typeof b['is_closed_won'] === 'boolean') updates['is_closed_won'] = b['is_closed_won']
    if (typeof b['is_closed_lost'] === 'boolean') updates['is_closed_lost'] = b['is_closed_lost']

    const { data: updated, error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*, pipeline_stages(id, name, color), contacts(id, full_name), companies(id, name)')
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // Activity logging for stage changes
    const dealTitle = (updated?.title as string) ?? existing.title
    const contactId = (updated?.contact_id as string) ?? existing.contact_id

    if (
      typeof b['pipeline_stage_id'] === 'string' &&
      b['pipeline_stage_id'] !== existing.pipeline_stage_id
    ) {
      const oldName = (existing.pipeline_stages as { name: string } | null)?.name ?? 'Unknown'
      const newName = (updated?.pipeline_stages as { name: string } | null)?.name ?? 'Unknown'
      void logActivity({
        tenantId: authed.tenantId,
        contactId: contactId ?? undefined,
        type: 'stage_change',
        body: `Deal moved: "${dealTitle}" \u2192 "${newName}"`,
        metadata: { deal_id: req.params['id'], stage_from: oldName, stage_to: newName },
        actorType: 'user',
        actorId: authed.userId,
      })
    }

    if (b['is_closed_won'] === true && !existing.is_closed_won) {
      void logActivity({
        tenantId: authed.tenantId,
        contactId: contactId ?? undefined,
        type: 'system',
        body: `Deal won: "${dealTitle}" \u2014 $${Number(updated?.value ?? existing.value).toFixed(2)}`,
        actorType: 'user',
        actorId: authed.userId,
      })
    }

    if (b['is_closed_lost'] === true && !existing.is_closed_lost) {
      void logActivity({
        tenantId: authed.tenantId,
        contactId: contactId ?? undefined,
        type: 'system',
        body: `Deal lost: "${dealTitle}"`,
        actorType: 'user',
        actorId: authed.userId,
      })
    }

    res.json({
      ...updated,
      stage_name: (updated?.pipeline_stages as { name: string } | null)?.name ?? null,
      stage_color: (updated?.pipeline_stages as { color: string } | null)?.color ?? null,
      contact_name: (updated?.contacts as { full_name: string } | null)?.full_name ?? null,
      company_name: (updated?.companies as { name: string } | null)?.name ?? null,
    })
  }
)

// ── DELETE /api/deals/:id (soft) ─────────────────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    await supabase
      .from('deals')
      .update({ is_archived: true })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    res.json({ archived: true })
  }
)

export default router
