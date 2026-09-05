import type { getServiceClient } from './supabase.js'
import { sanitizeSearchTerm } from './sanitize-search.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactsQuery = any
type Supabase = ReturnType<typeof getServiceClient>

/** Multi-select filter fields arrive two shapes: comma-joined query-string
 *  values from contacts.ts's req.query, or real arrays from a saved smart
 *  list's JSONB filters (apps/web/.../ContactFilters.tsx's FilterState).
 *  Normalize both to a string[]. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') return value.split(',').filter(Boolean)
  return []
}

/** Boolean filter fields arrive as the string 'true' from query params, or a
 *  real boolean from a saved smart list's JSONB filters. */
function isTruthy(value: unknown): boolean {
  return value === true || value === 'true'
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Applies every pre-query contacts filter (archived, text search, pipeline
 * stage, source, tags, date ranges, referral source, lifecycle stage, lead
 * score range, grade, assigned-to, territory) to a contacts query builder.
 * Shared between contacts.ts's GET / (query params) and
 * segment-resolver.ts's resolveSegmentContactIds (a saved smart list's
 * filters JSONB) — the two callers pass different-shaped input for the same
 * fields, hence the normalizers above.
 *
 * Does NOT apply has_open_quote (a post-query filter — see
 * applyOpenQuotePostFilter) or sort/pagination, which stay caller-specific.
 *
 * Returns { query } rather than the builder directly: Supabase's query
 * builder is thenable (awaiting it executes the query), and this is an
 * async function — `return q` from an async function implicitly does
 * `Promise.resolve(q)`, which unwraps a thenable by calling it, executing
 * the query early and collapsing the return value into its result instead
 * of the still-chainable builder. Wrapping in a plain object sidesteps that.
 */
export async function applyContactFilters(
  query: ContactsQuery,
  filters: Record<string, unknown>,
  supabase: Supabase,
  tenantId: string,
  /** Resolves an assigned_to: 'me' filter — the contacts.ts caller passes
   *  the requesting user's id; a background segment resolution (no current
   *  user) omits it, so 'me' degenerates to a literal non-matching value
   *  rather than crashing. */
  currentUserId?: string
): Promise<{ query: ContactsQuery }> {
  let q = query

  const archived = isTruthy(filters['archived'])
  if (!archived) {
    q = q.eq('is_archived', false)
  }

  const searchTerm = toTrimmedString(filters['search'] ?? filters['q'])
  if (searchTerm) {
    const sanitized = sanitizeSearchTerm(searchTerm)
    if (sanitized.length > 0) {
      const pattern = `%${sanitized}%`
      q = q.or(`full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
    }
  }

  const stageIds = toStringArray(filters['pipeline_stage_id'])
  if (stageIds.length > 0) {
    q = q.in('pipeline_stage', stageIds)
  }

  const pipelineId = toTrimmedString(filters['pipeline_id'])
  if (pipelineId) {
    const { data: stageData } = await supabase
      .from('pipeline_stages')
      .select('name')
      .eq('pipeline_id', pipelineId)
      .eq('tenant_id', tenantId)
    const stageNames = (stageData || []).map((s) => s.name)
    if (stageNames.length > 0) {
      q = q.in('pipeline_stage', stageNames)
    }
  }

  const sources = toStringArray(filters['source'])
  if (sources.length > 0) {
    q = q.in('source', sources)
  }

  const tags = toStringArray(filters['tags'])
  if (tags.length > 0) {
    q = q.contains('tags', tags)
  }

  const lastContactedFrom = toTrimmedString(filters['last_contacted_from'])
  const lastContactedTo = toTrimmedString(filters['last_contacted_to'])
  if (lastContactedFrom) q = q.gte('last_contacted', lastContactedFrom)
  if (lastContactedTo) q = q.lte('last_contacted', lastContactedTo)

  const createdFrom = toTrimmedString(filters['created_from'])
  const createdTo = toTrimmedString(filters['created_to'])
  if (createdFrom) q = q.gte('created_at', createdFrom)
  if (createdTo) q = q.lte('created_at', createdTo)

  const referralSource = toTrimmedString(filters['referral_source'])
  if (referralSource) {
    q = q.ilike('referral_source_detail', `%${referralSource}%`)
  }
  if (isTruthy(filters['has_referral_source'])) {
    q = q.not('referral_source_detail', 'is', null)
  }

  const lifecycleStages = toStringArray(filters['lifecycle_stage'])
  if (lifecycleStages.length > 0) {
    q = q.in('lifecycle_stage', lifecycleStages)
  }

  const minScore = toTrimmedString(filters['min_score'])
  const maxScore = toTrimmedString(filters['max_score'])
  if (minScore !== null) q = q.gte('lead_score', parseInt(minScore, 10))
  if (maxScore !== null) q = q.lte('lead_score', parseInt(maxScore, 10))

  const grades = toStringArray(filters['grade'])
  if (grades.length > 0) {
    q = q.in('lead_grade', grades)
  }

  const assignedTo = toTrimmedString(filters['assigned_to'])
  if (assignedTo) {
    q = q.eq('assigned_to_user_id', assignedTo === 'me' ? (currentUserId ?? 'me') : assignedTo)
  }

  const territory = toTrimmedString(filters['territory'])
  if (territory) {
    q = q.ilike('territory', `%${territory}%`)
  }

  return { query: q }
}

/**
 * Applies the has_open_quote post-filter — the one post-query filter a saved
 * smart list can actually carry (has_unread_sms is contacts-page-only and
 * stays inline in contacts.ts). Must run after the main query resolves,
 * since it needs the resolved contact ids to look up open quotes.
 */
export async function applyOpenQuotePostFilter<T extends { id: string }>(
  contacts: T[],
  filters: Record<string, unknown>,
  supabase: Supabase,
  tenantId: string
): Promise<T[]> {
  if (!isTruthy(filters['has_open_quote']) || contacts.length === 0) return contacts

  const contactIds = contacts.map((c) => c.id)
  const { data: openQuotes } = await supabase
    .from('quotes')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .in('contact_id', contactIds)
    .not('status', 'in', '("accepted","declined","expired")')

  if (!openQuotes) return contacts
  const idsWithQuotes = new Set(openQuotes.map((row) => row.contact_id))
  return contacts.filter((c) => idsWithQuotes.has(c.id))
}
