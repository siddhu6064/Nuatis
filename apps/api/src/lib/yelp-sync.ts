import { getServiceClient } from './supabase.js'
import { getYelpReviews } from './yelp-client.js'

// Mirrors gbp-sync.ts's upsert shape (onConflict tenant_id+google_review_id
// — that column now doubles as a generic external-review-id column, same
// convention the manual-entry route already established with its
// `manual-<uuid>` prefix). No AI-suggested-reply generation here — there's
// nowhere for a reply to go (Yelp has no reply API for third parties), so
// staff would only ever be typing a note for themselves, not sending anything.
export async function syncYelpReviews(tenantId: string): Promise<{ synced: number }> {
  const supabase = getServiceClient()

  const { data: conn } = await supabase
    .from('yelp_connections')
    .select('yelp_business_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!conn) return { synced: 0 }

  const reviews = await getYelpReviews(conn.yelp_business_id as string)
  if (reviews.length === 0) return { synced: 0 }

  const externalIds = reviews.map((r) => `yelp-${r.id}`)
  const { data: existingRows } = await supabase
    .from('reviews')
    .select('google_review_id')
    .eq('tenant_id', tenantId)
    .in('google_review_id', externalIds)
  const existingIds = new Set((existingRows ?? []).map((r) => r.google_review_id as string))

  // Insert-only, not upsert — an already-imported review may since have been
  // replied to or ignored locally; re-syncing must never clobber that state
  // back to 'new'. Yelp reviews are also effectively immutable once posted,
  // so there's nothing on the Yelp side worth overwriting anyway.
  const newRows = reviews
    .filter((r) => !existingIds.has(`yelp-${r.id}`))
    .map((r) => ({
      tenant_id: tenantId,
      google_review_id: `yelp-${r.id}`,
      source: 'yelp',
      reviewer_name: r.user?.name ?? null,
      rating: r.rating,
      comment: r.text ?? null,
      published_at: r.time_created,
      status: 'new',
    }))

  if (newRows.length === 0) return { synced: 0 }

  const { error } = await supabase.from('reviews').insert(newRows)

  if (error) {
    console.error('[yelp-sync] insert error:', error.message)
    return { synced: 0 }
  }

  return { synced: newRows.length }
}
