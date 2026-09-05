import { getServiceClient } from '../../lib/supabase.js'
import { applyContactFilters, applyOpenQuotePostFilter } from '../../lib/contact-filters.js'

export interface SegmentContact {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  sms_opt_in: boolean | null
  email_status: string | null
  email_risk_score: number | null
  sms_status: string | null
  sms_risk_score: number | null
}

/**
 * Resolves a saved smart list (campaigns.segment_id → smart_lists.id) into
 * the actual contacts it matches, by replaying its stored filters JSONB
 * through the same filter logic contacts.ts's GET / uses (via
 * apps/api/src/lib/contact-filters.ts). Used by campaign-sender.ts to fan
 * out a segment-scoped send, and by resolveSegmentDescription below for an
 * accurate recipient count.
 *
 * Returns [] if the smart list is missing/deleted or on any query error —
 * callers should treat an empty result as "nothing to send to," not as
 * "unfiltered/all contacts."
 */
export async function resolveSegmentContactIds(
  segmentId: string,
  tenantId: string
): Promise<SegmentContact[]> {
  const supabase = getServiceClient()

  const { data: segment, error: segErr } = await supabase
    .from('smart_lists')
    .select('filters')
    .eq('id', segmentId)
    .eq('tenant_id', tenantId)
    .single<{ filters: Record<string, unknown> | null }>()

  if (segErr || !segment) return []

  const filters = segment.filters ?? {}

  let query = supabase
    .from('contacts')
    .select(
      'id, full_name, phone, email, sms_opt_in, email_status, email_risk_score, sms_status, sms_risk_score'
    )
    .eq('tenant_id', tenantId)

  ;({ query } = await applyContactFilters(query, filters, supabase, tenantId))

  const { data, error } = await query
  if (error || !data) return []

  return applyOpenQuotePostFilter(data as SegmentContact[], filters, supabase, tenantId)
}

/**
 * Returns a human-readable description of a smart_list segment for use in
 * AI copy generation prompts, e.g. "Lapsed patients (6+ months) — 47 contacts".
 * The count is now the real resolved segment size (via
 * resolveSegmentContactIds), not a naive all-tenant-contacts count.
 *
 * On any error: returns "selected segment" so callers never have to handle throws.
 */
export async function resolveSegmentDescription(
  segmentId: string,
  tenantId: string
): Promise<string> {
  try {
    const supabase = getServiceClient()

    const { data: segment, error: segErr } = await supabase
      .from('smart_lists')
      .select('id, name')
      .eq('id', segmentId)
      .eq('tenant_id', tenantId)
      .single<{ id: string; name: string }>()

    if (segErr || !segment) {
      return 'selected segment'
    }

    const contacts = await resolveSegmentContactIds(segmentId, tenantId)
    return `${segment.name} — ${contacts.length} contacts`
  } catch {
    return 'selected segment'
  }
}
