import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { executeReport, clearReportCache } from '../lib/report-engine.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const VALID_OBJECTS = new Set([
  'contacts',
  'appointments',
  'deals',
  'quotes',
  'activity_log',
  'tasks',
])
const VALID_METRICS = new Set(['count', 'sum', 'avg', 'min', 'max'])
const VALID_CHART_TYPES = new Set(['bar', 'line', 'pie', 'table', 'number'])
const MAX_REPORTS_PER_TENANT = 50

// ── GET /api/reports ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  let query = supabase.from('reports').select('*').eq('tenant_id', authed.tenantId)

  if (req.query['pinned'] === 'true') {
    query = query.eq('pinned_to_dashboard', true)
  }

  const { data, error } = await query
    .order('pin_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ reports: data ?? [] })
})

// ── GET /api/reports/:id ──────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !data) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  res.json(data)
})

// ── POST /api/reports ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  // Validate required fields
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const object = typeof b['object'] === 'string' ? b['object'] : ''
  if (!VALID_OBJECTS.has(object)) {
    res.status(400).json({ error: `object must be one of: ${[...VALID_OBJECTS].join(', ')}` })
    return
  }

  const metric = typeof b['metric'] === 'string' ? b['metric'] : ''
  if (!VALID_METRICS.has(metric)) {
    res.status(400).json({ error: `metric must be one of: ${[...VALID_METRICS].join(', ')}` })
    return
  }

  const metric_field = typeof b['metric_field'] === 'string' ? b['metric_field'].trim() : null
  if (metric !== 'count' && !metric_field) {
    res.status(400).json({ error: 'metric_field is required when metric is not "count"' })
    return
  }

  const group_by = typeof b['group_by'] === 'string' ? b['group_by'].trim() : ''
  if (!group_by) {
    res.status(400).json({ error: 'group_by is required' })
    return
  }

  const chart_type =
    typeof b['chart_type'] === 'string' && VALID_CHART_TYPES.has(b['chart_type'])
      ? b['chart_type']
      : null

  // Max reports check
  const { count, error: countError } = await supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)

  if (countError) {
    res.status(500).json({ error: countError.message })
    return
  }

  if ((count ?? 0) >= MAX_REPORTS_PER_TENANT) {
    res
      .status(422)
      .json({ error: `Maximum of ${MAX_REPORTS_PER_TENANT} reports per tenant reached` })
    return
  }

  const { data: report, error } = await supabase
    .from('reports')
    .insert({
      tenant_id: authed.tenantId,
      created_by: authed.userId,
      name,
      description: typeof b['description'] === 'string' ? b['description'].trim() : null,
      object,
      metric,
      metric_field: metric_field ?? null,
      group_by,
      filters: b['filters'] && typeof b['filters'] === 'object' ? b['filters'] : null,
      date_range: typeof b['date_range'] === 'string' ? b['date_range'] : null,
      date_from: typeof b['date_from'] === 'string' ? b['date_from'] : null,
      date_to: typeof b['date_to'] === 'string' ? b['date_to'] : null,
      chart_type,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(report)
})

// ── PUT /api/reports/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('reports')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  // Validate optional fields that are present in the body
  const object = typeof b['object'] === 'string' ? b['object'] : undefined
  if (object !== undefined && !VALID_OBJECTS.has(object)) {
    res.status(400).json({ error: `object must be one of: ${[...VALID_OBJECTS].join(', ')}` })
    return
  }

  const metric = typeof b['metric'] === 'string' ? b['metric'] : undefined
  if (metric !== undefined && !VALID_METRICS.has(metric)) {
    res.status(400).json({ error: `metric must be one of: ${[...VALID_METRICS].join(', ')}` })
    return
  }

  const metric_field = typeof b['metric_field'] === 'string' ? b['metric_field'].trim() : undefined
  if (
    metric !== undefined &&
    metric !== 'count' &&
    metric_field === undefined &&
    !('metric_field' in b)
  ) {
    // metric_field not provided — will need to keep existing; skip check
  } else if (metric !== undefined && metric !== 'count' && 'metric_field' in b && !metric_field) {
    res.status(400).json({ error: 'metric_field is required when metric is not "count"' })
    return
  }

  const chart_type =
    typeof b['chart_type'] === 'string'
      ? VALID_CHART_TYPES.has(b['chart_type'])
        ? b['chart_type']
        : null
      : undefined

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if ('description' in b)
    updates['description'] = typeof b['description'] === 'string' ? b['description'].trim() : null
  if (object !== undefined) updates['object'] = object
  if (metric !== undefined) updates['metric'] = metric
  if (metric_field !== undefined) updates['metric_field'] = metric_field || null
  if (typeof b['group_by'] === 'string') updates['group_by'] = b['group_by'].trim()
  if ('filters' in b)
    updates['filters'] = b['filters'] && typeof b['filters'] === 'object' ? b['filters'] : null
  if ('date_range' in b)
    updates['date_range'] = typeof b['date_range'] === 'string' ? b['date_range'] : null
  if ('date_from' in b)
    updates['date_from'] = typeof b['date_from'] === 'string' ? b['date_from'] : null
  if ('date_to' in b) updates['date_to'] = typeof b['date_to'] === 'string' ? b['date_to'] : null
  if (chart_type !== undefined) updates['chart_type'] = chart_type

  const { data: updated, error } = await supabase
    .from('reports')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  await clearReportCache(authed.tenantId, id!)

  res.json(updated)
})

// ── DELETE /api/reports/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: existing } = await supabase
    .from('reports')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  const { error } = await supabase.from('reports').delete().eq('id', id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  await clearReportCache(authed.tenantId, id!)

  res.json({ deleted: true })
})

// ── PUT /api/reports/:id/pin ──────────────────────────────────────────────────
router.put('/:id/pin', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('reports')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  const pinned = typeof b['pinned'] === 'boolean' ? b['pinned'] : undefined
  if (pinned === undefined) {
    res.status(400).json({ error: 'pinned (boolean) is required' })
    return
  }

  const updates: Record<string, unknown> = { pinned_to_dashboard: pinned }
  if (typeof b['pin_order'] === 'number') {
    updates['pin_order'] = b['pin_order']
  } else if (!pinned) {
    updates['pin_order'] = null
  }

  const { data: updated, error } = await supabase
    .from('reports')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(updated)
})

// ── GET /api/reports/:id/data ─────────────────────────────────────────────────
router.get('/:id/data', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: report, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !report) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  try {
    const result = await executeReport(authed.tenantId, report)
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to execute report'
    res.status(500).json({ error: message })
  }
})

// ── POST /api/reports/:id/refresh ─────────────────────────────────────────────
router.post('/:id/refresh', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: report, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !report) {
    res.status(404).json({ error: 'Report not found' })
    return
  }

  await clearReportCache(authed.tenantId, id!)

  try {
    const result = await executeReport(authed.tenantId, report)
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to execute report'
    res.status(500).json({ error: message })
  }
})

export default router
