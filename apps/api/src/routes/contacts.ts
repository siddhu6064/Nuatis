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

// ── GET /api/contacts ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10) || 50))
  const offset = (page - 1) * limit

  // Start with base query
  let query = supabase
    .from('contacts')
    .select(
      'id, full_name, email, phone, pipeline_stage, source, tags, notes, vertical_data, is_archived, last_contacted, created_at',
      { count: 'exact' }
    )
    .eq('tenant_id', authed.tenantId)

  // ── Archived filter (default: exclude archived) ──
  const archived = req.query['archived'] === 'true'
  if (!archived) {
    query = query.eq('is_archived', false)
  }

  // ── Text search (q) ──
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : null
  if (q && q.length > 0) {
    const pattern = `%${q}%`
    query = query.or(
      `full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},vertical_data::text.ilike.${pattern}`
    )
  }

  // ── Pipeline stage filter (multi-select) ──
  const stageIds =
    typeof req.query['pipeline_stage_id'] === 'string'
      ? req.query['pipeline_stage_id'].split(',').filter(Boolean)
      : null
  if (stageIds && stageIds.length > 0) {
    query = query.in('pipeline_stage', stageIds)
  }

  // ── Source filter (multi-select) ──
  const sources =
    typeof req.query['source'] === 'string' ? req.query['source'].split(',').filter(Boolean) : null
  if (sources && sources.length > 0) {
    query = query.in('source', sources)
  }

  // ── Tags filter (AND — contact must have ALL tags) ──
  const tags =
    typeof req.query['tags'] === 'string' ? req.query['tags'].split(',').filter(Boolean) : null
  if (tags && tags.length > 0) {
    query = query.contains('tags', tags)
  }

  // ── Last contacted date range ──
  const lastContactedFrom =
    typeof req.query['last_contacted_from'] === 'string' ? req.query['last_contacted_from'] : null
  const lastContactedTo =
    typeof req.query['last_contacted_to'] === 'string' ? req.query['last_contacted_to'] : null
  if (lastContactedFrom) {
    query = query.gte('last_contacted', lastContactedFrom)
  }
  if (lastContactedTo) {
    query = query.lte('last_contacted', lastContactedTo)
  }

  // ── Created date range ──
  const createdFrom =
    typeof req.query['created_from'] === 'string' ? req.query['created_from'] : null
  const createdTo = typeof req.query['created_to'] === 'string' ? req.query['created_to'] : null
  if (createdFrom) {
    query = query.gte('created_at', createdFrom)
  }
  if (createdTo) {
    query = query.lte('created_at', createdTo)
  }

  // ── Sort ──
  const sortBy = typeof req.query['sort_by'] === 'string' ? req.query['sort_by'] : 'created_at'
  const sortDir = req.query['sort_dir'] === 'asc'
  query = query.order(sortBy, { ascending: sortDir })

  // ── Pagination ──
  query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // ── Post-filter: has_open_quote ──
  let contacts = data ?? []
  const hasOpenQuote = req.query['has_open_quote'] === 'true'
  if (hasOpenQuote && contacts.length > 0) {
    const contactIds = contacts.map((c) => c.id)
    const { data: openQuotes } = await supabase
      .from('quotes')
      .select('contact_id')
      .eq('tenant_id', authed.tenantId)
      .in('contact_id', contactIds)
      .not('status', 'in', '("accepted","declined","expired")')

    if (openQuotes) {
      const idsWithQuotes = new Set(openQuotes.map((q) => q.contact_id))
      contacts = contacts.filter((c) => idsWithQuotes.has(c.id))
    }
  }

  const total = count ?? 0
  res.json({
    contacts,
    total: hasOpenQuote ? contacts.length : total,
    page,
    pages: Math.ceil((hasOpenQuote ? contacts.length : total) / limit),
  })
})

// ── GET /api/contacts/tags ───────────────────────────────────────────────────
const tagsCache = new Map<string, { tags: string[]; expiry: number }>()

router.get('/tags', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const cacheKey = authed.tenantId
  const cached = tagsCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    res.json({ tags: cached.tags })
    return
  }

  const { data, error } = await supabase.rpc('get_distinct_contact_tags', {
    p_tenant_id: authed.tenantId,
  })

  // Fallback if RPC doesn't exist: raw query via select
  if (error) {
    // Fallback: fetch all contacts with tags and deduplicate in JS
    const { data: contacts } = await supabase
      .from('contacts')
      .select('tags')
      .eq('tenant_id', authed.tenantId)
      .not('tags', 'eq', '{}')

    const tagSet = new Set<string>()
    if (contacts) {
      for (const c of contacts) {
        const arr = c.tags as string[] | null
        if (arr) arr.forEach((t: string) => tagSet.add(t))
      }
    }

    const tags = [...tagSet].sort()
    tagsCache.set(cacheKey, { tags, expiry: Date.now() + 5 * 60 * 1000 })
    res.json({ tags })
    return
  }

  const tags = ((data as Array<{ tag: string }>) ?? []).map((r) => r.tag).sort()
  tagsCache.set(cacheKey, { tags, expiry: Date.now() + 5 * 60 * 1000 })
  res.json({ tags })
})

// ── GET /api/contacts/stages ─────────────────────────────────────────────────
router.get('/stages', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('id, name, position, color')
    .eq('tenant_id', authed.tenantId)
    .order('position', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ stages: data ?? [] })
})

// ── GET /api/contacts/:id ────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', req.params['id'])
    .eq('tenant_id', authed.tenantId)
    .single()

  if (error || !contact) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  res.json(contact)
})

export default router
