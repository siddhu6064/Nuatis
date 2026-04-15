import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

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

// ── Helper: find possible duplicates ─────────────────────────────────────────
async function findDuplicates(
  supabase: ReturnType<typeof getSupabase>,
  tenantId: string,
  phone: string | null,
  email: string | null,
  excludeId?: string
): Promise<Array<{ id: string; full_name: string; phone: string | null; email: string | null }>> {
  if (!phone && !email) return []
  const conditions: string[] = []
  if (phone) {
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length >= 7) conditions.push(`phone.ilike.%${digits}%`)
  }
  if (email) conditions.push(`email.ilike.${email.toLowerCase().trim()}`)
  if (conditions.length === 0) return []

  let query = supabase
    .from('contacts')
    .select('id, full_name, phone, email')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)
    .or(conditions.join(','))
    .limit(3)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data } = await query
  return data ?? []
}

// ── POST /api/contacts ───────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const fullName = typeof b['full_name'] === 'string' ? b['full_name'].trim() : ''
  if (!fullName) {
    res.status(400).json({ error: 'full_name is required' })
    return
  }

  const phone = typeof b['phone'] === 'string' ? b['phone'].trim() : null
  const email = typeof b['email'] === 'string' ? b['email'].trim().toLowerCase() : null

  const { data: contact, error } = await supabase
    .from('contacts')
    .insert({
      tenant_id: authed.tenantId,
      full_name: fullName,
      phone: phone || null,
      email: email || null,
      source: typeof b['source'] === 'string' ? b['source'] : 'manual',
      tags: Array.isArray(b['tags']) ? b['tags'] : [],
      notes: typeof b['notes'] === 'string' ? b['notes'] : null,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Check for possible duplicates
  const possibleDuplicates = await findDuplicates(
    supabase,
    authed.tenantId,
    phone,
    email,
    contact.id
  )

  res.status(201).json({ ...contact, possible_duplicates: possibleDuplicates })
})

// ── PUT /api/contacts/:id ────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b['full_name'] === 'string') updates['full_name'] = b['full_name'].trim()
  if (typeof b['phone'] === 'string') updates['phone'] = b['phone'].trim() || null
  if (typeof b['email'] === 'string') updates['email'] = b['email'].trim().toLowerCase() || null
  if (typeof b['notes'] === 'string') updates['notes'] = b['notes']
  if (Array.isArray(b['tags'])) updates['tags'] = b['tags']
  if (typeof b['pipeline_stage'] === 'string') updates['pipeline_stage'] = b['pipeline_stage']
  if (typeof b['is_archived'] === 'boolean') updates['is_archived'] = b['is_archived']

  const { data: updated, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Check for duplicates if phone/email changed
  const phone = typeof b['phone'] === 'string' ? b['phone'].trim() : null
  const email = typeof b['email'] === 'string' ? b['email'].trim() : null
  let possibleDuplicates: Array<{
    id: string
    full_name: string
    phone: string | null
    email: string | null
  }> = []
  if (phone || email) {
    possibleDuplicates = await findDuplicates(supabase, authed.tenantId, phone, email, id)
  }

  res.json({ ...updated, possible_duplicates: possibleDuplicates })
})

// ── GET /api/contacts/duplicates ─────────────────────────────────────────────
router.get('/duplicates', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  // Find contacts with matching phone or email
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name, phone, email, created_at')
    .eq('tenant_id', authed.tenantId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })

  if (!contacts || contacts.length === 0) {
    res.json({ pairs: [] })
    return
  }

  interface DupPair {
    contact_a: {
      id: string
      full_name: string
      phone: string | null
      email: string | null
      created_at: string
    }
    contact_b: {
      id: string
      full_name: string
      phone: string | null
      email: string | null
      created_at: string
    }
    confidence: number
    match_reason: string
  }

  const pairs: DupPair[] = []
  const seen = new Set<string>()

  // Index by normalized phone and email
  const phoneMap = new Map<string, typeof contacts>()
  const emailMap = new Map<string, typeof contacts>()

  for (const c of contacts) {
    if (c.phone) {
      const normalized = c.phone.replace(/\D/g, '').slice(-10)
      if (normalized.length >= 7) {
        const existing = phoneMap.get(normalized) ?? []
        existing.push(c)
        phoneMap.set(normalized, existing)
      }
    }
    if (c.email) {
      const normalized = c.email.toLowerCase().trim()
      if (normalized) {
        const existing = emailMap.get(normalized) ?? []
        existing.push(c)
        emailMap.set(normalized, existing)
      }
    }
  }

  // Find pairs
  for (const group of phoneMap.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!
        const b = group[j]!
        const key = [a.id, b.id].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)

        const sameEmail = a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()
        pairs.push({
          contact_a: a,
          contact_b: b,
          confidence: sameEmail ? 100 : 80,
          match_reason: sameEmail ? 'Same phone + email' : 'Same phone',
        })
      }
    }
  }

  for (const group of emailMap.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!
        const b = group[j]!
        const key = [a.id, b.id].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)

        pairs.push({
          contact_a: a,
          contact_b: b,
          confidence: 70,
          match_reason: 'Same email',
        })
      }
    }
  }

  // Sort by confidence desc, limit 50
  pairs.sort((a, b) => b.confidence - a.confidence)
  res.json({ pairs: pairs.slice(0, 50) })
})

// ── POST /api/contacts/merge ─────────────────────────────────────────────────
router.post('/merge', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const primaryId = typeof b['primary_id'] === 'string' ? b['primary_id'] : null
  const secondaryId = typeof b['secondary_id'] === 'string' ? b['secondary_id'] : null

  if (!primaryId || !secondaryId) {
    res.status(400).json({ error: 'primary_id and secondary_id are required' })
    return
  }
  if (primaryId === secondaryId) {
    res.status(400).json({ error: 'Cannot merge a contact with itself' })
    return
  }

  const fieldChoices = (b['field_choices'] as Record<string, string>) ?? {}

  // Fetch both contacts
  const [{ data: primary }, { data: secondary }] = await Promise.all([
    supabase
      .from('contacts')
      .select('*')
      .eq('id', primaryId)
      .eq('tenant_id', authed.tenantId)
      .single(),
    supabase
      .from('contacts')
      .select('*')
      .eq('id', secondaryId)
      .eq('tenant_id', authed.tenantId)
      .single(),
  ])

  if (!primary || !secondary) {
    res.status(404).json({ error: 'One or both contacts not found' })
    return
  }

  // Compute merged fields
  const merged: Record<string, unknown> = {}

  const pick = (field: string, primaryVal: unknown, secondaryVal: unknown) => {
    const choice = fieldChoices[field]
    if (choice === 'secondary') return secondaryVal
    return primaryVal // default to primary
  }

  merged['full_name'] = pick('name', primary.full_name, secondary.full_name)
  merged['phone'] = pick('phone', primary.phone, secondary.phone)
  merged['email'] = pick('email', primary.email, secondary.email)

  // Tags: always merge (union)
  const primaryTags = Array.isArray(primary.tags) ? (primary.tags as string[]) : []
  const secondaryTags = Array.isArray(secondary.tags) ? (secondary.tags as string[]) : []
  merged['tags'] = [...new Set([...primaryTags, ...secondaryTags])]

  // Custom fields
  if (fieldChoices['custom_fields'] === 'secondary') {
    merged['vertical_data'] = secondary.vertical_data
  }

  merged['updated_at'] = new Date().toISOString()

  // Update primary with merged values
  const { error: updateErr } = await supabase.from('contacts').update(merged).eq('id', primaryId)

  if (updateErr) {
    res.status(500).json({ error: updateErr.message })
    return
  }

  // Reassign child records
  await Promise.all([
    supabase.from('activity_log').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
    supabase.from('tasks').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
    supabase.from('appointments').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
    supabase.from('quotes').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
  ])

  // Archive secondary
  await supabase
    .from('contacts')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', secondaryId)

  // Log activity
  void logActivity({
    tenantId: authed.tenantId,
    contactId: primaryId,
    type: 'system',
    body: `Merged with contact: "${secondary.full_name}"`,
    metadata: { merged_contact_id: secondaryId, merged_contact_name: secondary.full_name },
    actorType: 'user',
    actorId: authed.userId,
  })

  // Fetch updated primary
  const { data: result } = await supabase.from('contacts').select('*').eq('id', primaryId).single()

  res.json(result)
})

// ── GET /api/contacts/:id (must be after /duplicates, /tags, /stages) ────────
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
