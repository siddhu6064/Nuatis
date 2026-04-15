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

// ── GET /api/pipelines ───────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  let query = supabase
    .from('pipelines')
    .select('id, name, description, is_default, pipeline_type, sort_order, created_at')
    .eq('tenant_id', authed.tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  const typeFilter = typeof req.query['type'] === 'string' ? req.query['type'] : null
  if (typeFilter === 'contacts' || typeFilter === 'deals') {
    query = query.eq('pipeline_type', typeFilter)
  }

  const { data: pipelines, error } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Get stage counts per pipeline
  const pipelineIds = (pipelines ?? []).map((p) => p.id as string)
  const stageCounts: Record<string, number> = {}

  if (pipelineIds.length > 0) {
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('pipeline_id')
      .in('pipeline_id', pipelineIds)

    for (const s of stages ?? []) {
      const pid = s.pipeline_id as string
      stageCounts[pid] = (stageCounts[pid] ?? 0) + 1
    }
  }

  const result = (pipelines ?? []).map((p) => ({
    ...p,
    stage_count: stageCounts[p.id as string] ?? 0,
  }))

  res.json({ pipelines: result })
})

// ── GET /api/pipelines/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !pipeline) {
    res.status(404).json({ error: 'Pipeline not found' })
    return
  }

  const { data: stages, error: stagesError } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('pipeline_id', id)
    .eq('tenant_id', authed.tenantId)
    .order('position', { ascending: true })

  if (stagesError) {
    res.status(500).json({ error: stagesError.message })
    return
  }

  // For each stage, get contact and deal counts
  const stagesWithCounts = await Promise.all(
    (stages ?? []).map(async (stage) => {
      const stageName = stage.name as string
      const stageId = stage.id as string

      const [{ count: contactCount }, { count: dealCount }] = await Promise.all([
        supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', authed.tenantId)
          .eq('pipeline_stage', stageName),
        supabase
          .from('deals')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', authed.tenantId)
          .eq('pipeline_stage_id', stageId)
          .eq('is_archived', false),
      ])

      return {
        ...stage,
        contact_count: contactCount ?? 0,
        deal_count: dealCount ?? 0,
      }
    })
  )

  res.json({ ...pipeline, stages: stagesWithCounts })
})

// ── POST /api/pipelines ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const pipelineType =
    b['pipelineType'] === 'deals' ? 'deals' : b['pipelineType'] === 'contacts' ? 'contacts' : null
  if (!pipelineType) {
    res.status(400).json({ error: 'pipelineType must be "contacts" or "deals"' })
    return
  }

  const description = typeof b['description'] === 'string' ? b['description'] : null

  // Max 10 pipelines per tenant
  const { count: existingCount } = await supabase
    .from('pipelines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)

  if ((existingCount ?? 0) >= 10) {
    res.status(400).json({ error: 'Maximum of 10 pipelines per tenant reached' })
    return
  }

  // Check if first pipeline of this type — set is_default = true
  const { count: typeCount } = await supabase
    .from('pipelines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
    .eq('pipeline_type', pipelineType)

  const isDefault = (typeCount ?? 0) === 0

  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .insert({
      tenant_id: authed.tenantId,
      name,
      description,
      pipeline_type: pipelineType,
      is_default: isDefault,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Insert stages if provided
  const stagesInput = Array.isArray(b['stages']) ? (b['stages'] as Record<string, unknown>[]) : []
  if (stagesInput.length > 0) {
    const stageRows = stagesInput.map((s, idx) => ({
      tenant_id: authed.tenantId,
      pipeline_id: pipeline.id as string,
      name: typeof s['name'] === 'string' ? s['name'].trim() : `Stage ${idx + 1}`,
      color: typeof s['color'] === 'string' ? s['color'] : null,
      probability: typeof s['probability'] === 'number' ? s['probability'] : 0,
      position: typeof s['position'] === 'number' ? s['position'] : idx,
    }))

    const { error: stagesError } = await supabase.from('pipeline_stages').insert(stageRows)

    if (stagesError) {
      res.status(500).json({ error: stagesError.message })
      return
    }
  }

  res.status(201).json(pipeline)
})

// ── PUT /api/pipelines/:id ───────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('pipelines')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Pipeline not found' })
    return
  }

  const updates: Record<string, unknown> = {}
  if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
  if (typeof b['description'] === 'string') updates['description'] = b['description']
  if (b['description'] === null) updates['description'] = null

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No updatable fields provided' })
    return
  }

  const { data: updated, error } = await supabase
    .from('pipelines')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(updated)
})

// ── DELETE /api/pipelines/:id ────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id, is_default')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!pipeline) {
    res.status(404).json({ error: 'Pipeline not found' })
    return
  }

  if (pipeline.is_default) {
    res.status(400).json({ error: 'Cannot delete default pipeline' })
    return
  }

  // Get all stages for this pipeline
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', id)
    .eq('tenant_id', authed.tenantId)

  if (stages && stages.length > 0) {
    const stageIds = stages.map((s) => s.id as string)
    const stageNames = stages.map((s) => s.name as string)

    // Check contacts referencing these stages (by name)
    const { count: contactCount } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .in('pipeline_stage', stageNames)

    // Check deals referencing these stages (by id)
    const { count: dealCount } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .in('pipeline_stage_id', stageIds)
      .eq('is_archived', false)

    const totalRefs = (contactCount ?? 0) + (dealCount ?? 0)
    if (totalRefs > 0) {
      res.status(400).json({
        error: `Cannot delete pipeline: ${totalRefs} contact(s)/deal(s) reference stages in this pipeline`,
        count: totalRefs,
      })
      return
    }
  }

  const { error } = await supabase
    .from('pipelines')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ deleted: true })
})

// ── PUT /api/pipelines/:id/set-default ──────────────────────────────────────
router.put('/:id/set-default', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  const { data: pipeline } = await supabase
    .from('pipelines')
    .select('id, pipeline_type')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!pipeline) {
    res.status(404).json({ error: 'Pipeline not found' })
    return
  }

  // Unset previous default of same type for this tenant
  await supabase
    .from('pipelines')
    .update({ is_default: false })
    .eq('tenant_id', authed.tenantId)
    .eq('pipeline_type', pipeline.pipeline_type as string)
    .eq('is_default', true)

  const { data: updated, error } = await supabase
    .from('pipelines')
    .update({ is_default: true })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json(updated)
})

// ── GET /api/pipelines/:pipelineId/stages ────────────────────────────────────
router.get(
  '/:pipelineId/stages',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { pipelineId } = req.params

    // Verify pipeline belongs to tenant
    const { data: pipeline } = await supabase
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' })
      return
    }

    const { data: stages, error } = await supabase
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .order('position', { ascending: true })

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ stages: stages ?? [] })
  }
)

// ── POST /api/pipelines/:pipelineId/stages ───────────────────────────────────
router.post(
  '/:pipelineId/stages',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { pipelineId } = req.params
    const b = req.body as Record<string, unknown>

    // Verify pipeline belongs to tenant
    const { data: pipeline } = await supabase
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' })
      return
    }

    const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const color = typeof b['color'] === 'string' ? b['color'] : null
    const probability = typeof b['probability'] === 'number' ? b['probability'] : 0

    // Auto-assign position if not provided (max existing + 1)
    let position: number
    if (typeof b['position'] === 'number') {
      position = b['position']
    } else {
      const { data: maxStage } = await supabase
        .from('pipeline_stages')
        .select('position')
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      position = maxStage ? (maxStage.position as number) + 1 : 0
    }

    const { data: stage, error } = await supabase
      .from('pipeline_stages')
      .insert({
        tenant_id: authed.tenantId,
        pipeline_id: pipelineId,
        name,
        color,
        probability,
        position,
      })
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.status(201).json(stage)
  }
)

// ── PUT /api/pipelines/:pipelineId/stages/reorder ────────────────────────────
// NOTE: This route must be defined BEFORE /:pipelineId/stages/:stageId
//       so "reorder" is not interpreted as a :stageId param.
router.put(
  '/:pipelineId/stages/reorder',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { pipelineId } = req.params
    const b = req.body as Record<string, unknown>

    // Verify pipeline belongs to tenant
    const { data: pipeline } = await supabase
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!pipeline) {
      res.status(404).json({ error: 'Pipeline not found' })
      return
    }

    const stageIds = Array.isArray(b['stageIds']) ? (b['stageIds'] as string[]) : []
    if (stageIds.length === 0) {
      res.status(400).json({ error: 'stageIds array is required' })
      return
    }

    for (let i = 0; i < stageIds.length; i++) {
      await supabase
        .from('pipeline_stages')
        .update({ position: i })
        .eq('id', stageIds[i])
        .eq('pipeline_id', pipelineId)
        .eq('tenant_id', authed.tenantId)
    }

    res.json({ updated: true })
  }
)

// ── PUT /api/pipelines/:pipelineId/stages/:stageId ───────────────────────────
router.put(
  '/:pipelineId/stages/:stageId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { pipelineId, stageId } = req.params
    const b = req.body as Record<string, unknown>

    // Verify stage belongs to this pipeline and tenant
    const { data: existing } = await supabase
      .from('pipeline_stages')
      .select('id')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) {
      res.status(404).json({ error: 'Stage not found' })
      return
    }

    const updates: Record<string, unknown> = {}
    if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
    if (typeof b['color'] === 'string') updates['color'] = b['color']
    if (b['color'] === null) updates['color'] = null
    if (typeof b['probability'] === 'number') updates['probability'] = b['probability']
    if (typeof b['position'] === 'number') updates['position'] = b['position']

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No updatable fields provided' })
      return
    }

    const { data: updated, error } = await supabase
      .from('pipeline_stages')
      .update(updates)
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json(updated)
  }
)

// ── DELETE /api/pipelines/:pipelineId/stages/:stageId ────────────────────────
router.delete(
  '/:pipelineId/stages/:stageId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { pipelineId, stageId } = req.params

    // Verify stage belongs to this pipeline and tenant
    const { data: stage } = await supabase
      .from('pipeline_stages')
      .select('id, name')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!stage) {
      res.status(404).json({ error: 'Stage not found' })
      return
    }

    const stageName = stage.name as string

    // Check contacts referencing this stage (by name)
    const { count: contactCount } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .eq('pipeline_stage', stageName)

    // Check deals referencing this stage (by id)
    const { count: dealCount } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .eq('pipeline_stage_id', stageId)
      .eq('is_archived', false)

    const totalRefs = (contactCount ?? 0) + (dealCount ?? 0)
    if (totalRefs > 0) {
      res.status(400).json({
        error: `Cannot delete stage: ${totalRefs} contact(s)/deal(s) reference this stage`,
        count: totalRefs,
      })
      return
    }

    const { error } = await supabase
      .from('pipeline_stages')
      .delete()
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ deleted: true })
  }
)

export default router
