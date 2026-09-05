import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import { sanitizeSearchTerm } from '../lib/sanitize-search.js'
import { logActivity } from '../lib/activity.js'
import type { NextFunction } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'

const router = Router()

async function requireCompanies(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'companies')
  if (!enabled) {
    res.status(403).json({ error: 'Companies module is not enabled' })
    return
  }
  next()
}

// ── GET /api/companies ───────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
    const offset = (page - 1) * limit
    const archived = req.query['archived'] === 'true'

    let query = supabase
      .from('companies')
      .select('*', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)

    if (!archived) query = query.eq('is_archived', false)

    const q = typeof req.query['q'] === 'string' ? sanitizeSearchTerm(req.query['q']) : null
    if (q) {
      query = query.or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
    }

    query = query.order('name', { ascending: true }).range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    // Get contact counts
    const companies = data ?? []
    const companyIds = companies.map((c) => c.id)
    const contactCounts: Record<string, number> = {}

    if (companyIds.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('company_id')
        .eq('tenant_id', authed.tenantId)
        .in('company_id', companyIds)

      if (contacts) {
        for (const c of contacts) {
          const cid = c.company_id as string
          contactCounts[cid] = (contactCounts[cid] ?? 0) + 1
        }
      }
    }

    const enriched = companies.map((c) => ({ ...c, contact_count: contactCounts[c.id] ?? 0 }))

    res.json({ companies: enriched, total: count ?? 0, page })
  }
)

// ── GET /api/companies/duplicates ────────────────────────────────────────────
// Mounted BEFORE /:id so "duplicates" isn't swallowed as an :id param.
// Full-tenant scan, mirrors contacts.ts's GET /duplicates: matches on exact
// domain (high confidence) or exact case-insensitive name (lower confidence).
router.get(
  '/duplicates',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, domain')
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    const byDomain = new Map<string, { id: string; name: string }[]>()
    const byName = new Map<string, { id: string; name: string }[]>()
    for (const c of companies ?? []) {
      const domain = typeof c.domain === 'string' ? c.domain.trim().toLowerCase() : ''
      if (domain) {
        const bucket = byDomain.get(domain) ?? []
        bucket.push({ id: c.id as string, name: c.name as string })
        byDomain.set(domain, bucket)
      }
      const name = typeof c.name === 'string' ? c.name.trim().toLowerCase() : ''
      if (name) {
        const bucket = byName.get(name) ?? []
        bucket.push({ id: c.id as string, name: c.name as string })
        byName.set(name, bucket)
      }
    }

    const pairs: Array<{
      company_a: { id: string; name: string }
      company_b: { id: string; name: string }
      confidence: number
      match_reason: string
    }> = []
    const seen = new Set<string>()

    function addPairs(
      groups: Map<string, { id: string; name: string }[]>,
      confidence: number,
      reason: string
    ) {
      for (const group of groups.values()) {
        if (group.length < 2) continue
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i]!
            const b = group[j]!
            const key = [a.id, b.id].sort().join(':')
            if (seen.has(key)) continue
            seen.add(key)
            pairs.push({ company_a: a, company_b: b, confidence, match_reason: reason })
          }
        }
      }
    }

    addPairs(byDomain, 100, 'domain')
    addPairs(byName, 70, 'name')

    pairs.sort((a, b) => b.confidence - a.confidence)
    res.json({ pairs: pairs.slice(0, 50) })
  }
)

// ── GET /api/companies/:id ───────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: company, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !company) {
      res.status(404).json({ error: 'Company not found' })
      return
    }

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, phone, email, pipeline_stage')
      .eq('company_id', company.id)
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)

    res.json({ ...company, contacts: contacts ?? [] })
  }
)

// ── POST /api/companies ──────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const { data, error } = await supabase
      .from('companies')
      .insert({
        tenant_id: authed.tenantId,
        name,
        domain: typeof b['domain'] === 'string' ? b['domain'].trim() : null,
        industry: typeof b['industry'] === 'string' ? b['industry'].trim() : null,
        employee_count: typeof b['employee_count'] === 'number' ? b['employee_count'] : null,
        address: typeof b['address'] === 'string' ? b['address'] : null,
        city: typeof b['city'] === 'string' ? b['city'] : null,
        state: typeof b['state'] === 'string' ? b['state'] : null,
        website: typeof b['website'] === 'string' ? b['website'] : null,
        notes: typeof b['notes'] === 'string' ? b['notes'] : null,
      })
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(201).json(data)
  }
)

// ── PUT /api/companies/:id ───────────────────────────────────────────────────
router.put(
  '/:id',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const updates: Record<string, unknown> = {}
    if (typeof b['name'] === 'string') updates['name'] = b['name'].trim()
    if (typeof b['domain'] === 'string') updates['domain'] = b['domain'].trim()
    if (typeof b['industry'] === 'string') updates['industry'] = b['industry']
    if (typeof b['employee_count'] === 'number') updates['employee_count'] = b['employee_count']
    if (typeof b['address'] === 'string') updates['address'] = b['address']
    if (typeof b['city'] === 'string') updates['city'] = b['city']
    if (typeof b['state'] === 'string') updates['state'] = b['state']
    if (typeof b['website'] === 'string') updates['website'] = b['website']
    if (typeof b['notes'] === 'string') updates['notes'] = b['notes']

    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json(data)
  }
)

// ── DELETE /api/companies/:id (soft) ─────────────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    await supabase
      .from('companies')
      .update({ is_archived: true })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    res.json({ archived: true })
  }
)

// ── POST /api/companies/merge ────────────────────────────────────────────────
// Body: { primary_id, secondary_id, field_choices?: { domain?, industry?,
// ...: 'secondary' } }. Reassigns the two known FKs to companies(id)
// (contacts.company_id, deals.company_id — confirmed exhaustive via a full
// grep of migrations/routes), archives the secondary rather than deleting it.
router.post(
  '/merge',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const primaryId = typeof b['primary_id'] === 'string' ? b['primary_id'] : ''
    const secondaryId = typeof b['secondary_id'] === 'string' ? b['secondary_id'] : ''
    const fieldChoices = (b['field_choices'] as Record<string, string> | undefined) ?? {}

    if (!primaryId || !secondaryId) {
      res.status(400).json({ error: 'primary_id and secondary_id are required' })
      return
    }
    if (primaryId === secondaryId) {
      res.status(400).json({ error: 'Cannot merge a company into itself' })
      return
    }

    const { data: primary } = await supabase
      .from('companies')
      .select('*')
      .eq('id', primaryId)
      .eq('tenant_id', authed.tenantId)
      .single()
    const { data: secondary } = await supabase
      .from('companies')
      .select('*')
      .eq('id', secondaryId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!primary || !secondary) {
      res.status(404).json({ error: 'Company not found' })
      return
    }

    const pick = (field: string): unknown =>
      fieldChoices[field] === 'secondary' ? secondary[field] : primary[field]

    const merged: Record<string, unknown> = {
      domain: pick('domain'),
      industry: pick('industry'),
      employee_count: pick('employee_count'),
      address: pick('address'),
      city: pick('city'),
      state: pick('state'),
      website: pick('website'),
      notes: fieldChoices['notes'] === 'secondary' ? secondary['notes'] : primary['notes'],
    }

    await supabase
      .from('companies')
      .update(merged)
      .eq('id', primaryId)
      .eq('tenant_id', authed.tenantId)

    await Promise.all([
      supabase
        .from('contacts')
        .update({ company_id: primaryId })
        .eq('company_id', secondaryId)
        .eq('tenant_id', authed.tenantId),
      supabase
        .from('deals')
        .update({ company_id: primaryId })
        .eq('company_id', secondaryId)
        .eq('tenant_id', authed.tenantId),
    ])

    await supabase
      .from('companies')
      .update({ is_archived: true })
      .eq('id', secondaryId)
      .eq('tenant_id', authed.tenantId)

    void logActivity({
      tenantId: authed.tenantId,
      companyId: primaryId,
      type: 'system',
      body: `Merged "${secondary.name as string}" into this company`,
      metadata: { merged_company_id: secondaryId },
      actorType: 'user',
      actorId: authed.userId,
    })

    const { data: result } = await supabase
      .from('companies')
      .select('*')
      .eq('id', primaryId)
      .single()

    res.json(result)
  }
)

async function validateBulkIds(
  supabase: SupabaseClient,
  tenantId: string,
  ids: unknown
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'ids must be a non-empty array' }
  }
  if (ids.length > 500) {
    return { ok: false, error: 'ids cannot exceed 500' }
  }
  const stringIds = ids.filter((id): id is string => typeof id === 'string')
  if (stringIds.length !== ids.length) {
    return { ok: false, error: 'ids must be strings' }
  }
  const { data } = await supabase
    .from('companies')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', stringIds)
  const validIds = new Set((data ?? []).map((r) => r.id as string))
  const filtered = stringIds.filter((id) => validIds.has(id))
  if (filtered.length === 0) {
    return { ok: false, error: 'No matching companies found' }
  }
  return { ok: true, ids: filtered }
}

// ── POST /api/companies/bulk/archive ─────────────────────────────────────────
router.post(
  '/bulk/archive',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const b = req.body as Record<string, unknown>

    const validated = await validateBulkIds(supabase, authed.tenantId, b['ids'])
    if (!validated.ok) {
      res.status(400).json({ error: validated.error })
      return
    }

    const { error } = await supabase
      .from('companies')
      .update({ is_archived: true })
      .eq('tenant_id', authed.tenantId)
      .in('id', validated.ids)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ success: true, archived: validated.ids.length })
  }
)

export default router
