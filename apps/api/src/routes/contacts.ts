import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'
import { notifyOwner } from '../lib/notifications.js'

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
      'id, full_name, email, phone, pipeline_stage, source, tags, notes, vertical_data, is_archived, last_contacted, created_at, lifecycle_stage, lead_score, lead_grade, lead_score_updated_at, assigned_to_user_id',
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

  // ── Referral source filter ──
  const referralSource =
    typeof req.query['referral_source'] === 'string' ? req.query['referral_source'].trim() : null
  if (referralSource) {
    query = query.ilike('referral_source_detail', `%${referralSource}%`)
  }
  const hasReferralSource = req.query['has_referral_source'] === 'true'
  if (hasReferralSource) {
    query = query.not('referral_source_detail', 'is', null)
  }

  // ── Lifecycle stage filter (multi-select) ──
  const lifecycleStage =
    typeof req.query['lifecycle_stage'] === 'string' ? req.query['lifecycle_stage'].trim() : null
  if (lifecycleStage) {
    const stages = lifecycleStage.split(',').filter(Boolean)
    if (stages.length > 0) {
      query = query.in('lifecycle_stage', stages)
    }
  }

  // ── Lead score range filters ──
  const minScore = typeof req.query['min_score'] === 'string' ? req.query['min_score'] : null
  const maxScore = typeof req.query['max_score'] === 'string' ? req.query['max_score'] : null
  if (minScore !== null) {
    query = query.gte('lead_score', parseInt(minScore, 10))
  }
  if (maxScore !== null) {
    query = query.lte('lead_score', parseInt(maxScore, 10))
  }

  // ── Lead grade filter (multi-select) ──
  const gradeParam = typeof req.query['grade'] === 'string' ? req.query['grade'].trim() : null
  if (gradeParam) {
    const grades = gradeParam.split(',').filter(Boolean)
    if (grades.length > 0) {
      query = query.in('lead_grade', grades)
    }
  }

  // ── Assigned-to filter ──
  const assignedTo =
    typeof req.query['assigned_to'] === 'string' ? req.query['assigned_to'].trim() : null
  if (assignedTo) {
    const assignedUserId = assignedTo === 'me' ? authed.userId : assignedTo
    query = query.eq('assigned_to_user_id', assignedUserId)
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

  // ── Post-filter: has_unread_sms ──
  const hasUnreadSms = req.query['has_unread_sms'] === 'true'
  if (hasUnreadSms && contacts.length > 0) {
    const contactIds = contacts.map((c) => c.id)
    const { data: unreadSms } = await supabase
      .from('inbound_sms')
      .select('contact_id')
      .eq('tenant_id', authed.tenantId)
      .eq('direction', 'inbound')
      .eq('status', 'received')
      .in('contact_id', contactIds)

    if (unreadSms) {
      const idsWithUnread = new Set(unreadSms.map((s) => s.contact_id))
      contacts = contacts.filter((c) => idsWithUnread.has(c.id))
    }
  }

  const total = count ?? 0
  const postFiltered = hasOpenQuote || hasUnreadSms
  res.json({
    contacts,
    total: postFiltered ? contacts.length : total,
    page,
    pages: Math.ceil((postFiltered ? contacts.length : total) / limit),
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
      referred_by_contact_id:
        typeof b['referred_by_contact_id'] === 'string' ? b['referred_by_contact_id'] : null,
      referral_source_detail:
        typeof b['referral_source_detail'] === 'string'
          ? b['referral_source_detail'].slice(0, 200)
          : null,
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

  enqueueScoreCompute(authed.tenantId, contact.id, 'contact_created')

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
    .select('id, assigned_to_user_id')
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
  if (typeof b['referred_by_contact_id'] === 'string')
    updates['referred_by_contact_id'] = b['referred_by_contact_id']
  if (b['referred_by_contact_id'] === null) updates['referred_by_contact_id'] = null
  if (typeof b['referral_source_detail'] === 'string')
    updates['referral_source_detail'] = b['referral_source_detail'].slice(0, 200)
  if (b['referral_source_detail'] === null) updates['referral_source_detail'] = null
  if (typeof b['assigned_to_user_id'] === 'string')
    updates['assigned_to_user_id'] = b['assigned_to_user_id']
  if (b['assigned_to_user_id'] === null) updates['assigned_to_user_id'] = null

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

  // Log assignment change if assigned_to_user_id changed
  const newAssignedUserId =
    'assigned_to_user_id' in updates ? (updates['assigned_to_user_id'] as string | null) : undefined
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
        contactId: id,
        type: 'system',
        body: `Contact assigned to ${userName}`,
        metadata: { assigned_to_user_id: newAssignedUserId },
        actorType: 'user',
        actorId: authed.userId,
      })
      void notifyOwner(authed.tenantId, 'contact_assigned', {
        pushTitle: 'Contact Assigned',
        pushBody: `A contact has been assigned to ${userName}`,
      })
    } else {
      void logActivity({
        tenantId: authed.tenantId,
        contactId: id,
        type: 'system',
        body: 'Contact unassigned',
        metadata: { assigned_to_user_id: null },
        actorType: 'user',
        actorId: authed.userId,
      })
    }
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

  enqueueScoreCompute(authed.tenantId, req.params['id'], 'contact_updated')

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

// ── Bulk helper: validate contact_ids belong to tenant ───────────────────────
async function validateBulkIds(
  supabase: ReturnType<typeof getSupabase>,
  tenantId: string,
  contactIds: string[]
): Promise<{ valid: boolean; error?: string }> {
  if (!contactIds || contactIds.length === 0)
    return { valid: false, error: 'contact_ids is required' }
  if (contactIds.length > 500)
    return { valid: false, error: 'Maximum 500 contacts per bulk operation' }
  const { count } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('id', contactIds)
  if ((count ?? 0) !== contactIds.length)
    return { valid: false, error: 'Some contact IDs do not belong to this tenant' }
  return { valid: true }
}

// ── POST /api/contacts/bulk/stage ────────────────────────────────────────────
router.post('/bulk/stage', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { contact_ids, pipeline_stage_id } = req.body as {
    contact_ids: string[]
    pipeline_stage_id: string
  }

  const check = await validateBulkIds(supabase, authed.tenantId, contact_ids)
  if (!check.valid) {
    res.status(400).json({ error: check.error })
    return
  }

  // Verify stage belongs to tenant
  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('id', pipeline_stage_id)
    .eq('tenant_id', authed.tenantId)
    .single()
  if (!stage) {
    res.status(400).json({ error: 'Invalid pipeline stage' })
    return
  }

  const { count } = await supabase
    .from('contacts')
    .update({ pipeline_stage: stage.name })
    .eq('tenant_id', authed.tenantId)
    .in('id', contact_ids)

  for (const cid of contact_ids) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: cid,
      type: 'stage_change',
      body: `Moved to "${stage.name}" (bulk)`,
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ updated: count ?? contact_ids.length })
})

// ── POST /api/contacts/bulk/tag ──────────────────────────────────────────────
router.post('/bulk/tag', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { contact_ids, tags_to_add, tags_to_remove } = req.body as {
    contact_ids: string[]
    tags_to_add?: string[]
    tags_to_remove?: string[]
  }

  const check = await validateBulkIds(supabase, authed.tenantId, contact_ids)
  if (!check.valid) {
    res.status(400).json({ error: check.error })
    return
  }

  const addTags = tags_to_add?.filter(Boolean) ?? []
  const removeTags = tags_to_remove?.filter(Boolean) ?? []
  if (addTags.length === 0 && removeTags.length === 0) {
    res.status(400).json({ error: 'At least one of tags_to_add or tags_to_remove is required' })
    return
  }

  // Fetch current tags for each contact and update
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, tags')
    .eq('tenant_id', authed.tenantId)
    .in('id', contact_ids)

  let updated = 0
  for (const c of contacts ?? []) {
    const currentTags = Array.isArray(c.tags) ? (c.tags as string[]) : []
    const combined = new Set([...currentTags, ...addTags])
    for (const t of removeTags) combined.delete(t)
    await supabase
      .from('contacts')
      .update({ tags: [...combined] })
      .eq('id', c.id)
    updated++

    const parts: string[] = []
    if (addTags.length > 0) parts.push(`added [${addTags.join(', ')}]`)
    if (removeTags.length > 0) parts.push(`removed [${removeTags.join(', ')}]`)
    void logActivity({
      tenantId: authed.tenantId,
      contactId: c.id,
      type: 'system',
      body: `Tags updated (bulk): ${parts.join(', ')}`,
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ updated })
})

// ── POST /api/contacts/bulk/sms ──────────────────────────────────────────────
router.post('/bulk/sms', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { contact_ids, message } = req.body as { contact_ids: string[]; message: string }

  const check = await validateBulkIds(supabase, authed.tenantId, contact_ids)
  if (!check.valid) {
    res.status(400).json({ error: check.error })
    return
  }

  if (!message || message.length === 0) {
    res.status(400).json({ error: 'message is required' })
    return
  }
  if (message.length > 320) {
    res.status(400).json({ error: 'message must be 320 chars or less' })
    return
  }

  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', authed.tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  const apiKey = process.env['TELNYX_API_KEY']
  if (!location?.telnyx_number || !apiKey) {
    res.status(400).json({ error: 'SMS not configured — no Telnyx number found' })
    return
  }

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name, phone')
    .eq('tenant_id', authed.tenantId)
    .in('id', contact_ids)

  let sent = 0
  const skippedReasons: Array<{ contact_id: string; reason: string }> = []

  for (const c of contacts ?? []) {
    if (!c.phone) {
      skippedReasons.push({ contact_id: c.id, reason: 'No phone number' })
      continue
    }

    const firstName = (c.full_name ?? '').split(' ')[0] ?? ''
    const substituted = message.replace(/\{\{first_name\}\}/g, firstName)

    try {
      await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: location.telnyx_number,
          to: c.phone,
          text: substituted,
        }),
      })
      sent++

      void logActivity({
        tenantId: authed.tenantId,
        contactId: c.id,
        type: 'sms',
        body: `Bulk SMS sent: "${substituted.slice(0, 60)}${substituted.length > 60 ? '...' : ''}"`,
        actorType: 'user',
        actorId: authed.userId,
      })

      // Rate limit: 50ms between sends
      await new Promise((resolve) => setTimeout(resolve, 50))
    } catch (err) {
      skippedReasons.push({
        contact_id: c.id,
        reason: err instanceof Error ? err.message : 'Send failed',
      })
    }
  }

  res.json({ sent, skipped: skippedReasons.length, skipped_reasons: skippedReasons })
})

// ── POST /api/contacts/bulk/archive ──────────────────────────────────────────
router.post('/bulk/archive', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { contact_ids } = req.body as { contact_ids: string[] }

  const check = await validateBulkIds(supabase, authed.tenantId, contact_ids)
  if (!check.valid) {
    res.status(400).json({ error: check.error })
    return
  }

  const { count } = await supabase
    .from('contacts')
    .update({ is_archived: true })
    .eq('tenant_id', authed.tenantId)
    .in('id', contact_ids)

  for (const cid of contact_ids) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: cid,
      type: 'system',
      body: 'Contact archived (bulk)',
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ updated: count ?? contact_ids.length })
})

// ── POST /api/contacts/bulk/export ───────────────────────────────────────────
router.post('/bulk/export', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { contact_ids } = req.body as { contact_ids?: string[] }

  let contacts: Array<Record<string, unknown>>

  if (contact_ids && contact_ids.length > 0) {
    if (contact_ids.length > 5000) {
      res.status(400).json({ error: 'Maximum 5000 contacts per export' })
      return
    }
    const { data } = await supabase
      .from('contacts')
      .select(
        'full_name, phone, email, source, tags, pipeline_stage, created_at, referral_source_detail, vertical_data'
      )
      .eq('tenant_id', authed.tenantId)
      .in('id', contact_ids)
    contacts = data ?? []
  } else {
    const { data } = await supabase
      .from('contacts')
      .select(
        'full_name, phone, email, source, tags, pipeline_stage, created_at, referral_source_detail, vertical_data'
      )
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(5000)
    contacts = data ?? []
  }

  // Build CSV
  const headers = [
    'name',
    'phone',
    'email',
    'source',
    'tags',
    'pipeline_stage',
    'created_at',
    'referral_source',
  ]
  const rows = contacts.map((c) => [
    csvEscape(String(c['full_name'] ?? '')),
    csvEscape(String(c['phone'] ?? '')),
    csvEscape(String(c['email'] ?? '')),
    csvEscape(String(c['source'] ?? '')),
    csvEscape(Array.isArray(c['tags']) ? (c['tags'] as string[]).join(';') : ''),
    csvEscape(String(c['pipeline_stage'] ?? '')),
    csvEscape(String(c['created_at'] ?? '')),
    csvEscape(String(c['referral_source_detail'] ?? '')),
  ])

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  const date = new Date().toISOString().split('T')[0]

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="contacts-export-${date}.csv"`)
  res.send(csv)
})

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

// ── GET /api/contacts/referral-sources ────────────────────────────────────────
router.get('/referral-sources', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data } = await supabase
    .from('contacts')
    .select('referral_source_detail')
    .eq('tenant_id', authed.tenantId)
    .not('referral_source_detail', 'is', null)

  const sources = [...new Set((data ?? []).map((r) => r.referral_source_detail as string))].sort()
  res.json({ sources })
})

const VALID_LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'marketing_qualified',
  'sales_qualified',
  'opportunity',
  'customer',
  'evangelist',
  'other',
] as const

// ── PATCH /api/contacts/:id/lifecycle ────────────────────────────────────────
router.patch('/:id/lifecycle', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { id } = req.params
  const b = req.body as Record<string, unknown>

  const newStage = typeof b['lifecycle_stage'] === 'string' ? b['lifecycle_stage'] : null
  if (
    !newStage ||
    !VALID_LIFECYCLE_STAGES.includes(newStage as (typeof VALID_LIFECYCLE_STAGES)[number])
  ) {
    res.status(400).json({
      error: `lifecycle_stage must be one of: ${VALID_LIFECYCLE_STAGES.join(', ')}`,
    })
    return
  }

  // Fetch current lifecycle_stage
  const { data: existing } = await supabase
    .from('contacts')
    .select('id, lifecycle_stage')
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .single()

  if (!existing) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }

  const oldStage = existing.lifecycle_stage as string | null

  const { data: updated, error } = await supabase
    .from('contacts')
    .update({ lifecycle_stage: newStage, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authed.tenantId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  void logActivity({
    tenantId: authed.tenantId,
    contactId: id,
    type: 'lifecycle_change',
    body: `Lifecycle stage changed: ${oldStage ?? 'none'} → ${newStage}`,
    actorType: 'user',
    actorId: authed.userId,
  })

  res.json(updated)
})

// ── PATCH /api/contacts/bulk/lifecycle ───────────────────────────────────────
router.patch('/bulk/lifecycle', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const newStage = typeof b['lifecycle_stage'] === 'string' ? b['lifecycle_stage'] : null
  if (
    !newStage ||
    !VALID_LIFECYCLE_STAGES.includes(newStage as (typeof VALID_LIFECYCLE_STAGES)[number])
  ) {
    res.status(400).json({
      error: `lifecycle_stage must be one of: ${VALID_LIFECYCLE_STAGES.join(', ')}`,
    })
    return
  }

  const contactIds = Array.isArray(b['contactIds']) ? (b['contactIds'] as string[]) : []
  if (contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds is required and must be a non-empty array' })
    return
  }
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'Maximum 500 contacts per bulk operation' })
    return
  }

  // Fetch current lifecycle stages for all contacts (for activity log)
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, lifecycle_stage')
    .eq('tenant_id', authed.tenantId)
    .in('id', contactIds)

  if (!contacts || contacts.length === 0) {
    res.status(404).json({ error: 'No matching contacts found' })
    return
  }

  const { count, error } = await supabase
    .from('contacts')
    .update({ lifecycle_stage: newStage, updated_at: new Date().toISOString() })
    .eq('tenant_id', authed.tenantId)
    .in('id', contactIds)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  for (const c of contacts) {
    const oldStage = c.lifecycle_stage as string | null
    void logActivity({
      tenantId: authed.tenantId,
      contactId: c.id,
      type: 'lifecycle_change',
      body: `Lifecycle stage changed: ${oldStage ?? 'none'} → ${newStage}`,
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ updated: count ?? contacts.length })
})

// ── PATCH /api/contacts/bulk/assign ──────────────────────────────────────────
router.patch('/bulk/assign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const contactIds = Array.isArray(b['contactIds']) ? (b['contactIds'] as string[]) : []
  if (contactIds.length === 0) {
    res.status(400).json({ error: 'contactIds is required and must be a non-empty array' })
    return
  }
  if (contactIds.length > 500) {
    res.status(400).json({ error: 'Maximum 500 contacts per bulk operation' })
    return
  }

  const assignedToUserId = typeof b['assignedToUserId'] === 'string' ? b['assignedToUserId'] : null

  // Validate all contact IDs belong to tenant
  const { count: tenantCount } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', authed.tenantId)
    .in('id', contactIds)
  if ((tenantCount ?? 0) !== contactIds.length) {
    res.status(400).json({ error: 'Some contact IDs do not belong to this tenant' })
    return
  }

  // Resolve assignee name if assigning (not clearing)
  let assigneeName: string | null = null
  if (assignedToUserId) {
    const { data: assignee } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', assignedToUserId)
      .single()
    assigneeName = (assignee?.full_name as string | null) ?? assignedToUserId
  }

  const { count, error } = await supabase
    .from('contacts')
    .update({ assigned_to_user_id: assignedToUserId, updated_at: new Date().toISOString() })
    .eq('tenant_id', authed.tenantId)
    .in('id', contactIds)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  for (const cid of contactIds) {
    void logActivity({
      tenantId: authed.tenantId,
      contactId: cid,
      type: 'system',
      body: assigneeName
        ? `Contact assigned to ${assigneeName} (bulk)`
        : 'Contact unassigned (bulk)',
      metadata: { assigned_to_user_id: assignedToUserId },
      actorType: 'user',
      actorId: authed.userId,
    })
  }

  res.json({ updated: count ?? contactIds.length })
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
