import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { isModuleEnabled } from '../lib/modules.js'
import type { NextFunction } from 'express'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

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
    const supabase = getSupabase()

    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
    const offset = (page - 1) * limit
    const archived = req.query['archived'] === 'true'

    let query = supabase
      .from('companies')
      .select('*', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)

    if (!archived) query = query.eq('is_archived', false)

    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : null
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

// ── GET /api/companies/:id ───────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireCompanies,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

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
    const supabase = getSupabase()
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
    const supabase = getSupabase()
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
    const supabase = getSupabase()

    await supabase
      .from('companies')
      .update({ is_archived: true })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    res.json({ archived: true })
  }
)

export default router
