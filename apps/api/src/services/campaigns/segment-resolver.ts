import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── resolveSegmentDescription ─────────────────────────────────────────────────
//
// Returns a human-readable description of a smart_list segment for use in
// AI copy generation prompts, e.g. "Lapsed patients (6+ months) — 47 contacts".
//
// Smart_list filters are stored as arbitrary JSONB; rather than attempting to
// interpret complex filter trees, we use the segment name plus a simple
// total-contacts count (per tenant) as a safe approximation.
//
// On any error: returns "selected segment" so callers never have to handle throws.

export async function resolveSegmentDescription(
  segmentId: string,
  tenantId: string
): Promise<string> {
  try {
    const supabase = getSupabase()

    // ── Fetch segment name ────────────────────────────────────────────────────
    const { data: segment, error: segErr } = await supabase
      .from('smart_lists')
      .select('id, name')
      .eq('id', segmentId)
      .eq('tenant_id', tenantId)
      .single<{ id: string; name: string }>()

    if (segErr || !segment) {
      return 'selected segment'
    }

    // ── Count contacts for this tenant ────────────────────────────────────────
    const { count, error: countErr } = await supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)

    if (countErr || count === null) {
      return segment.name
    }

    return `${segment.name} — ${count} contacts`
  } catch {
    return 'selected segment'
  }
}
