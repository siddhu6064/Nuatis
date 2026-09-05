import { getServiceClient } from './supabase.js'
import { getFacebookConnection } from './facebook-oauth.js'

interface FacebookRating {
  open_graph_story?: {
    id: string
    message?: string
    data?: { rating?: number }
  }
  reviewer?: { name?: string }
  created_time: string
  recommendation_type?: 'positive' | 'negative'
  review_text?: string
  rating?: number
}

// Facebook Pages expose ratings/recommendations via /{page-id}/ratings, not a
// dedicated "reviews" endpoint. Newer Pages use thumbs-up/down
// recommendations (recommendation_type) instead of a 1-5 star rating —
// mapped to 5/1 here since the `reviews` table requires an integer rating.
// This function is unreachable in practice today: it's only ever called from
// POST /api/reputation/facebook/sync, which 503s before this runs unless a
// tenant has gone through the full OAuth connect flow — impossible without
// real META_APP_ID/META_APP_SECRET credentials and Meta App Review approval.
export async function syncFacebookReviews(tenantId: string): Promise<{ synced: number }> {
  const supabase = getServiceClient()
  const conn = await getFacebookConnection(tenantId)
  if (!conn) return { synced: 0 }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${conn.facebookPageId}/ratings?access_token=${conn.pageAccessToken}`
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[facebook-sync] ratings fetch failed: ${res.status} ${body.slice(0, 200)}`)
    return { synced: 0 }
  }
  const body = (await res.json()) as { data?: FacebookRating[] }
  const ratings = body.data ?? []
  if (ratings.length === 0) return { synced: 0 }

  const externalIds = ratings.map((r) => `facebook-${r.open_graph_story?.id ?? r.created_time}`)
  const { data: existingRows } = await supabase
    .from('reviews')
    .select('google_review_id')
    .eq('tenant_id', tenantId)
    .in('google_review_id', externalIds)
  const existingIds = new Set((existingRows ?? []).map((r) => r.google_review_id as string))

  const newRows = ratings
    .map((r) => {
      const id = `facebook-${r.open_graph_story?.id ?? r.created_time}`
      const rating =
        r.rating ??
        r.open_graph_story?.data?.rating ??
        (r.recommendation_type === 'positive' ? 5 : 1)
      return {
        tenant_id: tenantId,
        google_review_id: id,
        source: 'facebook',
        reviewer_name: r.reviewer?.name ?? null,
        rating,
        comment: r.review_text ?? r.open_graph_story?.message ?? null,
        published_at: r.created_time,
        status: 'new' as const,
      }
    })
    .filter((r) => !existingIds.has(r.google_review_id))

  if (newRows.length === 0) return { synced: 0 }

  const { error } = await supabase.from('reviews').insert(newRows)
  if (error) {
    console.error('[facebook-sync] insert error:', error.message)
    return { synced: 0 }
  }

  return { synced: newRows.length }
}
