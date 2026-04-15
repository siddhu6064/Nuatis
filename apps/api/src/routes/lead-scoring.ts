import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { getLeadScoreBulkQueue } from '../lib/lead-score-queue.js'

const router = Router()

const VALID_CATEGORIES = ['engagement', 'profile', 'behavior', 'decay'] as const
type RuleCategory = (typeof VALID_CATEGORIES)[number]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/lead-scoring — list scoring rules grouped by category ────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('lead_scoring_rules')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const grouped: Record<RuleCategory, typeof data> = {
    engagement: [],
    profile: [],
    behavior: [],
    decay: [],
  }

  for (const rule of data ?? []) {
    const cat = rule.category as RuleCategory
    if (cat in grouped) {
      grouped[cat].push(rule)
    }
  }

  res.json(grouped)
})

// ── PUT /api/lead-scoring/rules/:id — update a rule ──────────────────────────
router.put('/rules/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  // Verify rule belongs to tenant
  const { data: existing } = await supabase
    .from('lead_scoring_rules')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Rule not found' })
    return
  }

  const updates: Record<string, unknown> = {}
  if (typeof b['points'] === 'number') updates['points'] = b['points']
  if (typeof b['is_active'] === 'boolean') updates['is_active'] = b['is_active']
  if (typeof b['label'] === 'string') updates['label'] = b['label'].trim()

  const { data: updated, error } = await supabase
    .from('lead_scoring_rules')
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

// ── POST /api/lead-scoring/rules — add custom rule ───────────────────────────
router.post('/rules', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const category = b['category'] as string
  if (!VALID_CATEGORIES.includes(category as RuleCategory)) {
    res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
    return
  }

  const rule_key = typeof b['rule_key'] === 'string' ? b['rule_key'].trim() : null
  const label = typeof b['label'] === 'string' ? b['label'].trim() : null
  const points = typeof b['points'] === 'number' ? b['points'] : null

  if (!rule_key || !label || points === null) {
    res.status(400).json({ error: 'rule_key, label, and points are required' })
    return
  }

  const { data: created, error } = await supabase
    .from('lead_scoring_rules')
    .insert({
      tenant_id: authed.tenantId,
      category,
      rule_key,
      label,
      points,
      description: typeof b['description'] === 'string' ? b['description'] : null,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(201).json(created)
})

// ── DELETE /api/lead-scoring/rules/:id — delete a rule ───────────────────────
router.delete('/rules/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params

  // Verify rule belongs to tenant
  const { data: existing } = await supabase
    .from('lead_scoring_rules')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Rule not found' })
    return
  }

  const { error } = await supabase
    .from('lead_scoring_rules')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ success: true })
})

// ── POST /api/lead-scoring/rescore-all — trigger bulk re-score ───────────────
router.post('/rescore-all', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
    .eq('is_archived', false)

  const total = count ?? 0

  await getLeadScoreBulkQueue().add('bulk', { tenantId: authed.tenantId })

  res.json({ message: `Re-scoring started for ${total} contacts` })
})

// ── GET /api/lead-scoring/distribution — score distribution ──────────────────
router.get('/distribution', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Fetch all non-archived contacts with score fields
  const { data, error } = await supabase
    .from('contacts')
    .select('lead_grade, lead_score')
    .eq('tenant_id', authed.tenantId)
    .eq('is_archived', false)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const contacts = data ?? []
  const total = contacts.length

  // Count per grade
  const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
  const scores: number[] = []

  for (const c of contacts) {
    const grade = (c.lead_grade as string | null) ?? 'F'
    if (grade in distribution) {
      distribution[grade] = (distribution[grade] ?? 0) + 1
    }
    if (typeof c.lead_score === 'number') {
      scores.push(c.lead_score)
    }
  }

  // Compute average
  const average =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0

  // Compute median
  let median = 0
  if (scores.length > 0) {
    scores.sort((a, b) => a - b)
    const mid = Math.floor(scores.length / 2)
    median =
      scores.length % 2 === 0
        ? Math.round(((scores[mid - 1] ?? 0) + (scores[mid] ?? 0)) / 2)
        : (scores[mid] ?? 0)
  }

  res.json({ distribution, average, median, total })
})

export default router
