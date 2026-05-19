import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import ReputationClient from './ReputationClient'
import type { Review, ReputationStats } from '@nuatis/shared'

function mapReview(row: Record<string, unknown>): Review {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    googleReviewId: row['google_review_id'] as string,
    reviewerName: (row['reviewer_name'] as string | null) ?? null,
    rating: row['rating'] as number,
    comment: (row['comment'] as string | null) ?? null,
    publishedAt: (row['published_at'] as string | null) ?? null,
    replyText: (row['reply_text'] as string | null) ?? null,
    replySentAt: (row['reply_sent_at'] as string | null) ?? null,
    aiSuggestedReply: (row['ai_suggested_reply'] as string | null) ?? null,
    status: row['status'] as Review['status'],
    createdAt: row['created_at'] as string,
  }
}

function computeStats(
  allReviews: Array<{ rating: number; published_at: string | null }>
): ReputationStats {
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const total = allReviews.length
  const avgRating = total
    ? Math.round((allReviews.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10
    : 0

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>
  for (const r of allReviews) {
    breakdown[r.rating] = (breakdown[r.rating] ?? 0) + 1
  }

  const reviewsThisMonth = allReviews.filter(
    (r) => r.published_at && new Date(r.published_at) >= thisMonthStart
  ).length

  const reviewsLastMonth = allReviews.filter(
    (r) =>
      r.published_at &&
      new Date(r.published_at) >= lastMonthStart &&
      new Date(r.published_at) < thisMonthStart
  ).length

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const monthGroups = new Map<string, { sum: number; count: number; date: Date }>()

  for (const r of allReviews) {
    if (!r.published_at) continue
    const d = new Date(r.published_at)
    if (d < sixMonthsAgo) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const existing = monthGroups.get(key)
    if (existing) {
      existing.sum += r.rating
      existing.count++
    } else {
      monthGroups.set(key, { sum: r.rating, count: 1, date: d })
    }
  }

  const trendData = [...monthGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([_, g]) => ({
      month: g.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      avgRating: Math.round((g.sum / g.count) * 10) / 10,
      count: g.count,
    }))

  return {
    averageRating: avgRating,
    totalReviews: total,
    ratingBreakdown: breakdown as Record<1 | 2 | 3 | 4 | 5, number>,
    reviewsThisMonth,
    reviewsLastMonth,
    trendData,
  }
}

export default async function ReputationPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  let connected = false
  let locationName: string | null = null
  let stats: ReputationStats | null = null
  let initialReviews: Review[] = []

  if (tenantId) {
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('location_name, place_id')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    connected = !!conn
    locationName = conn?.location_name ?? null

    if (connected) {
      const { data: allReviewRows } = await supabase
        .from('reviews')
        .select('rating, published_at')
        .eq('tenant_id', tenantId)

      if (allReviewRows && allReviewRows.length > 0) {
        stats = computeStats(allReviewRows)
      }

      const { data: newReviewRows } = await supabase
        .from('reviews')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'new')
        .order('published_at', { ascending: false })
        .limit(20)

      initialReviews = (newReviewRows ?? []).map((row) => mapReview(row as Record<string, unknown>))
    }
  }

  return (
    <ReputationClient
      connected={connected}
      locationName={locationName}
      stats={stats}
      initialReviews={initialReviews}
    />
  )
}
