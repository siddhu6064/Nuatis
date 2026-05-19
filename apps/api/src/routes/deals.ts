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
    .select(
      '*, pipeline_stages(id, name, color), contacts(id, full_name), companies(id, name), assigned_to_user_id',
      { count: 'exact' }
    )
    .eq('tenant_id', authed.tenantId)

  const archived = req.query['archived'] === 'true'
  if (!archived) query = query.eq('is_archived', false)

  const stageIds =
    typeof req.query['pipeline_stage_id'] === 'string'
      ? req.query['pipeline_stage_id'].split(',').filter(Boolean)
      : null
  if (stageIds && stageIds.length > 0) query = query.in('pipeline_stage_id', stageIds)

  // ── Pipeline ID filter (fetch stage IDs for the given pipeline) ──
  const pipelineId = req.query['pipeline_id'] as string | undefined
  if (pipelineId) {
    const { data: stageData } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineId)
    const pipelineStageIds = (stageData || []).map((s) => s.id)
    if (pipelineStageIds.length > 0) {
      query = query.in('pipeline_stage_id', pipelineStageIds)
    }
  }

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

  // ── Assigned-to filter ──
  const assignedTo =
    typeof req.query['assigned_to'] === 'string' ? req.query['assigned_to'].trim() : null
  if (assignedTo) {
    const assignedUserId = assignedTo === 'me' ? authed.userId : assignedTo
    query = query.eq('assigned_to_user_id', assignedUserId)
  }

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

// ── GET /api/deals/funnel ────────────────────────────────────────────────────
router.get(
  '/funnel',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: pipelines } = await supabase
      .from('pipelines')
      .select('id')
      .eq('tenant_id', authed.tenantId)
      .eq('is_default', true)
      .limit(1)

    const pipelineId = pipelines?.[0]?.id as string | undefined
    if (!pipelineId) {
      res.json({ stages: [] })
      return
    }

    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id, name, position, probability')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true })

    if (!stages || stages.length === 0) {
      res.json({ stages: [] })
      return
    }

    const stageIds = stages.map((s) => s.id as string)

    const { data: deals } = await supabase
      .from('deals')
      .select('pipeline_stage_id, value')
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)
      .eq('is_closed_won', false)
      .eq('is_closed_lost', false)
      .in('pipeline_stage_id', stageIds)

    const stageMap = new Map<string, { count: number; totalValue: number }>()
    for (const id of stageIds) stageMap.set(id, { count: 0, totalValue: 0 })
    for (const deal of deals ?? []) {
      const sid = deal.pipeline_stage_id as string
      const agg = stageMap.get(sid)
      if (agg) {
        agg.count++
        agg.totalValue += Number(deal.value ?? 0)
      }
    }

    const result = stages.map((stage, i) => {
      const agg = stageMap.get(stage.id as string) ?? { count: 0, totalValue: 0 }
      const nextAgg = stages[i + 1]
        ? (stageMap.get(stages[i + 1]!.id as string) ?? { count: 0, totalValue: 0 })
        : null
      const conversionToNext =
        nextAgg !== null && agg.count > 0 ? Math.round((nextAgg.count / agg.count) * 100) : null
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position,
        probability: stage.probability ?? null,
        count: agg.count,
        totalValue: agg.totalValue,
        conversionToNext,
      }
    })

    res.json({ stages: result })
  }
)

// ── GET /api/deals/velocity ──────────────────────────────────────────────────
router.get(
  '/velocity',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const now = new Date()
    const defaultStart = new Date(now.getTime() - 90 * 86400000).toISOString()
    const startDate =
      typeof req.query['startDate'] === 'string' ? req.query['startDate'] : defaultStart
    const endDate =
      typeof req.query['endDate'] === 'string' ? req.query['endDate'] : now.toISOString()

    const { data: wonDeals } = await supabase
      .from('deals')
      .select('value, created_at, updated_at, close_date')
      .eq('tenant_id', authed.tenantId)
      .eq('is_closed_won', true)
      .eq('is_archived', false)
      .gte('updated_at', startDate)
      .lte('updated_at', endDate)

    const deals = wonDeals ?? []
    const totalWon = deals.length

    const rangeMs = new Date(endDate).getTime() - new Date(startDate).getTime()
    const rangeMonths = Math.max(rangeMs / (30 * 86400000), 1)

    // avgDaysToClose
    let totalDays = 0
    let daysCount = 0
    for (const d of deals) {
      const closeAt = new Date(
        (d.close_date as string | null) ?? (d.updated_at as string)
      ).getTime()
      const days = (closeAt - new Date(d.created_at as string).getTime()) / 86400000
      if (days >= 0) {
        totalDays += days
        daysCount++
      }
    }
    const avgDaysToClose = daysCount > 0 ? Math.round((totalDays / daysCount) * 10) / 10 : 0

    // avgDealSize + totalValue
    const totalValue = deals.reduce((sum, d) => sum + Number(d.value ?? 0), 0)
    const avgDealSize = totalWon > 0 ? Math.round(totalValue / totalWon) : 0

    // dealsPerMonth + velocityPerMonth
    const dealsPerMonth = Math.round((totalWon / rangeMonths) * 10) / 10
    const velocityPerMonth = Math.round(dealsPerMonth * avgDealSize)

    // wonByMonth — group by YYYY-MM, then format label
    const monthMap = new Map<string, { count: number; value: number }>()
    for (const d of deals) {
      const key = ((d.close_date as string | null) ?? (d.updated_at as string)).slice(0, 7)
      const agg = monthMap.get(key) ?? { count: 0, value: 0 }
      agg.count++
      agg.value += Number(d.value ?? 0)
      monthMap.set(key, agg)
    }

    // Fill every month in range
    const wonByMonth: { month: string; count: number; value: number }[] = []
    const cur = new Date(startDate)
    cur.setDate(1)
    cur.setHours(0, 0, 0, 0)
    const endD = new Date(endDate)
    while (cur <= endD) {
      const key = cur.toISOString().slice(0, 7)
      const agg = monthMap.get(key) ?? { count: 0, value: 0 }
      const label = cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      wonByMonth.push({ month: label, count: agg.count, value: Math.round(agg.value) })
      cur.setMonth(cur.getMonth() + 1)
    }

    res.json({
      avgDaysToClose,
      dealsPerMonth,
      avgDealSize,
      velocityPerMonth,
      totalWon,
      totalValue: Math.round(totalValue),
      wonByMonth,
    })
  }
)

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

    const { data: dealContactRows } = await supabase
      .from('deal_contacts')
      .select('role, contacts(id, full_name, phone, email)')
      .eq('deal_id', req.params['id'])
      .limit(5)

    const dealContacts = (dealContactRows ?? []).map((row) => ({
      ...(row.contacts as unknown as {
        id: string
        full_name: string
        phone: string | null
        email: string | null
      }),
      role: row.role ?? null,
    }))

    res.json({
      ...deal,
      stage_name: (deal.pipeline_stages as { name: string } | null)?.name ?? null,
      stage_color: (deal.pipeline_stages as { color: string } | null)?.color ?? null,
      contact_name: (deal.contacts as { full_name: string } | null)?.full_name ?? null,
      company_name: (deal.companies as { name: string } | null)?.name ?? null,
      deal_contacts: dealContacts,
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
      created_by_user_id: authed.userId || null,
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
    if (typeof b['assigned_to_user_id'] === 'string')
      updates['assigned_to_user_id'] = b['assigned_to_user_id']
    if (b['assigned_to_user_id'] === null) updates['assigned_to_user_id'] = null

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

    // Activity logging for assignment changes
    const newAssignedUserId =
      'assigned_to_user_id' in updates
        ? (updates['assigned_to_user_id'] as string | null)
        : undefined
    if (
      newAssignedUserId !== undefined &&
      newAssignedUserId !== (existing.assigned_to_user_id as string | null)
    ) {
      if (newAssignedUserId) {
        const { data: assignee } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', newAssignedUserId)
          .single()
        const userName = (assignee?.full_name as string | null) ?? newAssignedUserId
        void logActivity({
          tenantId: authed.tenantId,
          contactId: contactId ?? undefined,
          type: 'system',
          body: `Deal assigned to ${userName}`,
          metadata: { deal_id: req.params['id'], assigned_to_user_id: newAssignedUserId },
          actorType: 'user',
          actorId: authed.userId,
        })
      } else {
        void logActivity({
          tenantId: authed.tenantId,
          contactId: contactId ?? undefined,
          type: 'system',
          body: `Deal unassigned`,
          metadata: { deal_id: req.params['id'], assigned_to_user_id: null },
          actorType: 'user',
          actorId: authed.userId,
        })
      }
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

// ── POST /api/deals/:id/contacts ─────────────────────────────────────────────
router.post(
  '/:id/contacts',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const b = req.body as Record<string, unknown>

    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!deal) {
      res.status(404).json({ error: 'Deal not found' })
      return
    }

    const { count } = await supabase
      .from('deal_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('deal_id', req.params['id'])

    if ((count ?? 0) >= 5) {
      res.status(400).json({ error: 'Maximum 5 contacts per deal' })
      return
    }

    const contactId = typeof b['contactId'] === 'string' ? b['contactId'] : null
    const role = typeof b['role'] === 'string' ? b['role'] : null

    if (!contactId) {
      res.status(400).json({ error: 'contactId required' })
      return
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' })
      return
    }

    const { error } = await supabase
      .from('deal_contacts')
      .insert({ deal_id: req.params['id'], contact_id: contactId, role })

    if (error?.code === '23505') {
      res.status(409).json({ error: 'Contact already on this deal' })
      return
    }
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.status(201).json({ success: true })
  }
)

// ── DELETE /api/deals/:id/contacts/:contactId ─────────────────────────────────
router.delete(
  '/:id/contacts/:contactId',
  requireAuth,
  requireDeals,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!deal) {
      res.status(404).json({ error: 'Deal not found' })
      return
    }

    await supabase
      .from('deal_contacts')
      .delete()
      .eq('deal_id', req.params['id'])
      .eq('contact_id', req.params['contactId'])

    res.json({ success: true })
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
