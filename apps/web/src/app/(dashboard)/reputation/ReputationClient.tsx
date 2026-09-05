'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { Modal } from '@/components/ui/Modal'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Review, ReputationStats } from '@nuatis/shared'
import VideoReviewsTab from './VideoReviewsTab'

interface Props {
  connected: boolean
  locationName: string | null
  stats: ReputationStats | null
}

type Tab = 'new' | 'replied' | 'all'
type PageTab = 'reviews' | 'requests' | 'video'

// ── ConnectBanner ─────────────────────────────────────────────

function ConnectBanner() {
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    setLoading(true)
    try {
      const res = await fetch('/api/reputation', { credentials: 'include' })
      const data = (await res.json()) as { url?: string }
      if (data.url) window.location.href = data.url
    } catch (err) {
      console.error('[reputation] connect error:', err)
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-8 flex flex-col items-center gap-4 mt-6">
      <div className="text-3xl">⭐</div>
      <h2 className="text-lg font-semibold text-ink">Connect Google Business Profile</h2>
      <p className="text-sm text-ink3 text-center max-w-md">
        See your reviews, track your rating, and reply with AI — all from Nuatis.
      </p>
      <Button onClick={() => void handleConnect()} disabled={loading} variant="contained">
        {loading ? 'Redirecting...' : 'Connect Google Business Profile'}
      </Button>
    </div>
  )
}

// ── OtherPlatformsPanel (Yelp + Facebook) ────────────────────

interface YelpBusiness {
  id: string
  name: string
  location: string | null
  rating: number | null
  review_count: number | null
}

function YelpConnectCard() {
  const [status, setStatus] = useState<{
    configured: boolean
    connected: boolean
    businessName: string | null
  } | null>(null)
  const [term, setTerm] = useState('')
  const [location, setLocation] = useState('')
  const [results, setResults] = useState<YelpBusiness[]>([])
  const [searching, setSearching] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refreshStatus() {
    fetch('/api/reputation/yelp/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  async function handleSearch() {
    if (!term.trim() || !location.trim()) return
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/reputation/yelp/search?term=${encodeURIComponent(term)}&location=${encodeURIComponent(location)}`,
        { credentials: 'include' }
      )
      const data = (await res.json()) as { businesses?: YelpBusiness[]; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Search failed')
        return
      }
      setResults(data.businesses ?? [])
    } finally {
      setSearching(false)
    }
  }

  async function handleConnect(business: YelpBusiness) {
    setConnecting(true)
    try {
      await fetch('/api/reputation/yelp/connect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: business.id, businessName: business.name }),
      })
      setResults([])
      refreshStatus()
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    await fetch('/api/reputation/yelp/disconnect', { method: 'DELETE', credentials: 'include' })
    refreshStatus()
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/reputation/yelp/sync', {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json()) as { synced?: number }
      if (typeof data.synced === 'number') {
        setError(`Synced ${data.synced} new review${data.synced === 1 ? '' : 's'}.`)
      }
    } finally {
      setSyncing(false)
    }
  }

  if (!status) return null

  if (!status.configured) {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-5 opacity-60">
        <p className="text-sm font-semibold text-ink">Yelp</p>
        <p className="text-xs text-ink4 mt-1">Not configured on this server.</p>
      </div>
    )
  }

  if (status.connected) {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-5">
        <p className="text-sm font-semibold text-ink">Yelp</p>
        <p className="text-xs text-ink3 mt-1">Connected to {status.businessName ?? 'a business'}</p>
        <p className="text-xs text-ink4 mt-1">
          Read-only import — Yelp has no reply API, so replies happen on Yelp directly.
        </p>
        <div className="flex gap-2 mt-3">
          <Button onClick={() => void handleSync()} disabled={syncing} size="small">
            {syncing ? 'Syncing...' : 'Sync Reviews'}
          </Button>
          <Button onClick={() => void handleDisconnect()} size="small" color="inherit">
            Disconnect
          </Button>
        </div>
        {error && <p className="text-xs text-ink3 mt-2">{error}</p>}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5">
      <p className="text-sm font-semibold text-ink mb-2">Connect Yelp</p>
      <div className="flex gap-2 mb-2">
        <TextField
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Business name"
          size="small"
          fullWidth
        />
        <TextField
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City, state"
          size="small"
          fullWidth
        />
        <Button
          onClick={() => void handleSearch()}
          disabled={searching || !term.trim() || !location.trim()}
          size="small"
          sx={{ flexShrink: 0 }}
        >
          {searching ? 'Searching...' : 'Search'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between text-xs bg-bg rounded-lg px-3 py-2"
            >
              <span className="text-ink2">
                {b.name}
                {b.location && <span className="text-ink4 ml-1.5">— {b.location}</span>}
              </span>
              <Button
                onClick={() => void handleConnect(b)}
                disabled={connecting}
                size="small"
                variant="contained"
              >
                Connect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FacebookConnectCard() {
  const [status, setStatus] = useState<{
    configured: boolean
    connected: boolean
    pageName: string | null
  } | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    fetch('/api/reputation/facebook/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
  }, [])

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await fetch('/api/reputation/facebook/auth-url', { credentials: 'include' })
      const data = (await res.json()) as { url?: string }
      if (data.url) window.location.href = data.url
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    await fetch('/api/reputation/facebook/disconnect', { method: 'DELETE', credentials: 'include' })
    setStatus((s) => (s ? { ...s, connected: false, pageName: null } : s))
  }

  if (!status) return null

  return (
    <div
      className={`bg-white rounded-xl border border-border-brand p-5 ${!status.configured ? 'opacity-60' : ''}`}
    >
      <p className="text-sm font-semibold text-ink">Facebook</p>
      {!status.configured ? (
        <p className="text-xs text-ink4 mt-1">Not configured on this server.</p>
      ) : status.connected ? (
        <>
          <p className="text-xs text-ink3 mt-1">Connected to {status.pageName ?? 'a Page'}</p>
          <Button
            onClick={() => void handleDisconnect()}
            size="small"
            color="inherit"
            sx={{ mt: 1.5 }}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          onClick={() => void handleConnect()}
          disabled={connecting}
          size="small"
          variant="contained"
          sx={{ mt: 1.5 }}
        >
          {connecting ? 'Redirecting...' : 'Connect Facebook'}
        </Button>
      )}
    </div>
  )
}

function OtherPlatformsPanel() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <YelpConnectCard />
      <FacebookConnectCard />
    </div>
  )
}

// ── StatsHeader ───────────────────────────────────────────────

function StatsHeader({ stats }: { stats: ReputationStats }) {
  const trend =
    stats.reviewsLastMonth > 0
      ? Math.round(
          ((stats.reviewsThisMonth - stats.reviewsLastMonth) / stats.reviewsLastMonth) * 100
        )
      : null

  const statCards = [
    { label: 'Average Rating', value: stats.averageRating.toFixed(1), sub: 'out of 5' },
    { label: 'Total Reviews', value: stats.totalReviews.toString(), sub: 'all time' },
    {
      label: 'This Month',
      value: stats.reviewsThisMonth.toString(),
      sub: trend !== null ? `${trend >= 0 ? '+' : ''}${trend}% vs last month` : 'vs last month',
    },
    { label: 'Last Month', value: stats.reviewsLastMonth.toString(), sub: 'reviews' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-border-brand p-5 flex flex-col gap-1"
          >
            <p className="text-xs font-medium text-ink4 uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-bold text-ink">{card.value}</p>
            <p className="text-xs text-ink3">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border-brand p-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Rating Breakdown</h3>
        <div className="space-y-2">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = stats.ratingBreakdown[star] ?? 0
            const pct = stats.totalReviews > 0 ? (count / stats.totalReviews) * 100 : 0
            return (
              <div key={star} className="flex items-center gap-3">
                <span className="text-xs text-ink3 w-4 text-right">{star}★</span>
                <div className="flex-1 bg-bg rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 bg-teal-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-ink3 w-8 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {stats.trendData.length > 0 && (
        <div className="bg-white rounded-xl border border-border-brand p-5">
          <h3 className="text-sm font-semibold text-ink mb-4">6-Month Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={stats.trendData}
              margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" domain={[1, 5]} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value, name) => [
                  name === 'avgRating'
                    ? typeof value === 'number'
                      ? value.toFixed(1)
                      : value
                    : value,
                  name === 'avgRating' ? 'Avg Rating' : 'Reviews',
                ]}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="left"
                dataKey="count"
                name="Reviews"
                fill="#99f6e4"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgRating"
                name="Avg Rating"
                stroke="#0d9488"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── ReviewCard ────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  google: 'Google',
  yelp: 'Yelp',
  facebook: 'Facebook',
  manual: 'Manual',
  other: 'Other',
}

function ReviewCard({
  review,
  onReply,
  onIgnore,
  onDelete,
}: {
  review: Review
  onReply: (id: string, text: string) => Promise<void>
  onIgnore: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [replyText, setReplyText] = useState(review.reply_text ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [ignoring, setIgnoring] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSend() {
    if (!replyText.trim()) return
    setSubmitting(true)
    await onReply(review.id, replyText)
    setSubmitting(false)
  }

  async function handleIgnore() {
    setIgnoring(true)
    await onIgnore(review.id)
    setIgnoring(false)
  }

  async function handleDelete() {
    if (!window.confirm('Remove this review? This cannot be undone.')) return
    setDeleting(true)
    await onDelete(review.id)
    setDeleting(false)
  }

  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {review.reviewer_name ?? 'Anonymous'}
            {review.source !== 'google' && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-bg2 text-ink4 font-normal align-middle">
                {SOURCE_LABEL[review.source] ?? review.source}
              </span>
            )}
          </p>
          <p className="text-xs text-amber-500 tracking-wider">{stars}</p>
          {review.published_at && (
            <p className="text-xs text-ink4 mt-0.5">
              {new Date(review.published_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              review.status === 'new'
                ? 'bg-teal-50 text-teal-700'
                : review.status === 'replied'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-gray-100 text-ink4'
            }`}
          >
            {review.status}
          </span>
          {review.source !== 'google' && (
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="text-xs text-ink4 hover:text-red-600"
              title="Remove this review"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {review.comment && <p className="text-sm text-ink3 leading-relaxed">{review.comment}</p>}

      {review.reply_text && (
        <div className="bg-bg rounded-lg p-3 text-sm text-ink3 border-l-2 border-teal-400">
          <p className="text-xs font-medium text-teal-700 mb-1">Your reply</p>
          {review.reply_text}
        </div>
      )}

      {review.status === 'new' && (
        <div className="space-y-2">
          {review.ai_suggested_reply ? (
            <div className="bg-teal-50 rounded-lg p-3 text-sm text-ink3">
              <p className="text-xs font-medium text-teal-700 mb-1">AI suggested reply</p>
              <p className="leading-relaxed">{review.ai_suggested_reply}</p>
              <button
                onClick={() => setReplyText(review.ai_suggested_reply!)}
                className="mt-2 text-xs font-medium text-teal-700 hover:text-teal-800 underline underline-offset-2"
              >
                Use this reply
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-ink4">
              <svg
                className="w-3.5 h-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.9-3M20 15a9 9 0 01-15.9 3"
                />
              </svg>
              Generating AI reply suggestion...
            </div>
          )}

          <TextField
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply..."
            multiline
            rows={3}
            fullWidth
            size="small"
          />

          <div className="flex items-center gap-2">
            <Button
              onClick={() => void handleSend()}
              disabled={submitting || !replyText.trim()}
              size="small"
              variant="contained"
            >
              {submitting ? 'Sending...' : 'Send Reply'}
            </Button>
            <Button
              onClick={() => void handleIgnore()}
              disabled={ignoring}
              size="small"
              color="inherit"
            >
              {ignoring ? '...' : '✕ Ignore'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ReviewFeed ────────────────────────────────────────────────

const MANUAL_SOURCES = ['yelp', 'facebook', 'manual', 'other'] as const

function ReviewFeed() {
  const [tab, setTab] = useState<Tab>('new')
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const [showAddModal, setShowAddModal] = useState(false)
  const [newSource, setNewSource] = useState<(typeof MANUAL_SOURCES)[number]>('yelp')
  const [newReviewerName, setNewReviewerName] = useState('')
  const [newRating, setNewRating] = useState(5)
  const [newComment, setNewComment] = useState('')
  const [newPublishedAt, setNewPublishedAt] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    void fetchReviews('new', 1)
  }, []) // mount-only: intentionally runs once

  async function fetchReviews(status: Tab, p: number) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' })
      if (status !== 'all') params.set('status', status)
      const res = await fetch(`/api/reputation/reviews?${params.toString()}`, {
        credentials: 'include',
      })
      const data = (await res.json()) as { reviews?: Review[]; total?: number }
      setReviews(data.reviews ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('[reputation] reviews fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleTabChange(newTab: Tab) {
    setTab(newTab)
    setPage(1)
    void fetchReviews(newTab, 1)
  }

  async function handleReply(id: string, replyText: string) {
    try {
      await fetch(`/api/reputation/reviews/${id}/reply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply_text: replyText }),
      })
      void fetchReviews(tab, page)
    } catch (err) {
      console.error('[reputation] reply error:', err)
    }
  }

  async function handleIgnore(id: string) {
    try {
      await fetch(`/api/reputation/reviews/${id}/ignore`, {
        method: 'PUT',
        credentials: 'include',
      })
      void fetchReviews(tab, page)
    } catch (err) {
      console.error('[reputation] ignore error:', err)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/reputation/reviews/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      void fetchReviews(tab, page)
    } catch (err) {
      console.error('[reputation] delete error:', err)
    }
  }

  function openAddModal() {
    setNewSource('yelp')
    setNewReviewerName('')
    setNewRating(5)
    setNewComment('')
    setNewPublishedAt('')
    setAddError('')
    setShowAddModal(true)
  }

  async function handleAddReview() {
    setAddSaving(true)
    setAddError('')
    try {
      const res = await fetch('/api/reputation/reviews/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: newSource,
          reviewer_name: newReviewerName.trim() || null,
          rating: newRating,
          comment: newComment.trim() || null,
          published_at: newPublishedAt ? new Date(newPublishedAt).toISOString() : undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddError((d as { error?: string }).error ?? 'Failed to save review')
        return
      }
      setShowAddModal(false)
      void fetchReviews(tab, page)
    } catch {
      setAddError('Network error')
    } finally {
      setAddSaving(false)
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'new', label: 'New' },
    { id: 'replied', label: 'Replied' },
    { id: 'all', label: 'All' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs
          value={tab}
          onChange={(_e, v: Tab) => handleTabChange(v)}
          sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t.id} value={t.id} label={t.label} sx={{ minHeight: 36, py: 0.5 }} />
          ))}
        </Tabs>
        <Button onClick={openAddModal} size="small" variant="outlined" color="inherit">
          + Add Review
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          Loading reviews...
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          No {tab === 'all' ? '' : tab} reviews found.
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              onReply={handleReply}
              onIgnore={handleIgnore}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {total > 20 && (
        <div className="flex items-center justify-between text-xs text-ink4 pt-2">
          <span>
            {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                const prev = Math.max(1, page - 1)
                setPage(prev)
                void fetchReviews(tab, prev)
              }}
              disabled={page === 1}
              size="small"
              variant="outlined"
              color="inherit"
            >
              ← Prev
            </Button>
            <Button
              onClick={() => {
                const next = page + 1
                setPage(next)
                void fetchReviews(tab, next)
              }}
              disabled={page * 20 >= total}
              size="small"
              variant="outlined"
              color="inherit"
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {showAddModal && (
        <Modal
          onClose={() => setShowAddModal(false)}
          title="Add a Review"
          footer={
            <>
              <Button onClick={() => setShowAddModal(false)} variant="text" color="inherit">
                Cancel
              </Button>
              <Button
                onClick={() => void handleAddReview()}
                disabled={addSaving}
                variant="contained"
              >
                {addSaving ? 'Saving…' : 'Add Review'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField
              select
              label="Source"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value as (typeof MANUAL_SOURCES)[number])}
              fullWidth
              size="small"
            >
              {MANUAL_SOURCES.map((s) => (
                <MenuItem key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Rating"
              value={newRating}
              onChange={(e) => setNewRating(Number(e.target.value))}
              fullWidth
              size="small"
            >
              {[5, 4, 3, 2, 1].map((r) => (
                <MenuItem key={r} value={r}>
                  {'★'.repeat(r) + '☆'.repeat(5 - r)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Reviewer name"
              helperText="optional"
              value={newReviewerName}
              onChange={(e) => setNewReviewerName(e.target.value)}
              fullWidth
              size="small"
            />

            <TextField
              label="Review text"
              helperText="optional"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              multiline
              rows={3}
              fullWidth
              size="small"
            />

            <TextField
              label="Date left"
              helperText="optional, defaults to today"
              type="date"
              value={newPublishedAt}
              onChange={(e) => setNewPublishedAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
              size="small"
            />

            {addError && <p className="text-xs text-rose-600">{addError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── RequestsPanel ─────────────────────────────────────────────

interface RequestStats {
  total_sent: number
  total_opened: number
  total_clicked: number
  total_completed: number
  open_rate: number
  click_rate: number
  completion_rate: number
  by_channel: {
    sms: { sent: number; opened: number; clicked: number; completed: number }
    email: { sent: number; opened: number; clicked: number; completed: number }
  }
  last_30_days: { sent: number; clicked: number; completed: number }
}

function RequestsPanel() {
  const [data, setData] = useState<RequestStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/review-requests/stats', { credentials: 'include' })
        if (!res.ok) return
        const json = (await res.json()) as RequestStats
        setData(json)
      } catch {
        // silently ignore
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-24" />
        ))}
      </div>
    )
  }

  if (!data || data.total_sent === 0) {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-8 flex flex-col items-center gap-3 text-center">
        <div className="text-2xl">📨</div>
        <p className="text-sm font-medium text-ink">No review requests yet</p>
        <p className="text-xs text-ink3 max-w-sm">
          Review requests will appear here after Maya sends them. Enable review requests in{' '}
          <a href="/reputation" className="text-teal-600 underline">
            Automation settings
          </a>
          .
        </p>
      </div>
    )
  }

  const statCards = [
    { label: 'Sent', value: data.total_sent, sub: 'total' },
    { label: 'Opened', value: data.total_opened, sub: `${data.open_rate}% open rate` },
    { label: 'Clicked', value: data.total_clicked, sub: `${data.click_rate}% click rate` },
    { label: 'Completed', value: data.total_completed, sub: `${data.completion_rate}% completed` },
  ]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-border-brand p-5">
            <p className="text-xs font-medium text-ink3 mb-1">{label}</p>
            <p className="text-2xl font-bold text-ink">{value}</p>
            <p className="text-xs text-ink4 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Channel breakdown */}
      <div className="bg-white rounded-xl border border-border-brand p-5">
        <h3 className="text-sm font-semibold text-ink mb-4">By Channel</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 text-ink3 font-medium">Channel</th>
              <th className="text-right py-2 text-ink3 font-medium">Sent</th>
              <th className="text-right py-2 text-ink3 font-medium">Opened</th>
              <th className="text-right py-2 text-ink3 font-medium">Clicked</th>
              <th className="text-right py-2 text-ink3 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {(['sms', 'email'] as const).map((ch) => {
              const c = data.by_channel[ch]
              return (
                <tr key={ch} className="border-t border-border-brand">
                  <td className="py-2 text-ink capitalize">{ch.toUpperCase()}</td>
                  <td className="py-2 text-right text-ink">{c.sent}</td>
                  <td className="py-2 text-right text-ink">{c.opened}</td>
                  <td className="py-2 text-right text-ink">{c.clicked}</td>
                  <td className="py-2 text-right text-ink">{c.completed}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Last 30 days summary */}
      <p className="text-xs text-ink3">
        Last 30 days:{' '}
        <span className="font-medium text-ink">{data.last_30_days.sent} review requests sent</span>
        {' · '}
        <span className="font-medium text-ink">
          {data.last_30_days.completed} completed (
          {data.last_30_days.sent > 0
            ? Math.round((data.last_30_days.completed / data.last_30_days.sent) * 100)
            : 0}
          %)
        </span>
      </p>
    </div>
  )
}

// ── ReputationClient ──────────────────────────────────────────

export default function ReputationClient({ connected, locationName, stats }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<number | null>(null)
  const [pageTab, setPageTab] = useState<PageTab>('reviews')

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/reputation/sync', {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json()) as { synced?: number }
      setLastSynced(data.synced ?? 0)
    } catch (err) {
      console.error('[reputation] sync error:', err)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Reputation</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {connected && locationName
              ? `Connected to ${locationName}`
              : 'Manage your Google reviews and public rating'}
          </p>
        </div>

        {connected && (
          <Button
            onClick={() => void handleSync()}
            disabled={syncing}
            variant="outlined"
            color="inherit"
            sx={{ flexShrink: 0 }}
            startIcon={
              <svg
                className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.9-3M20 15a9 9 0 01-15.9 3"
                />
              </svg>
            }
          >
            {syncing ? 'Syncing...' : 'Sync Reviews'}
          </Button>
        )}
      </div>

      {lastSynced !== null && (
        <div className="mb-4 px-4 py-2 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700">
          Synced {lastSynced} review{lastSynced !== 1 ? 's' : ''} from Google Business Profile.
        </div>
      )}

      <div className="space-y-6">
        {/* Page-level tabs */}
        <Tabs
          value={pageTab}
          onChange={(_e, v: PageTab) => setPageTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="reviews" label="Reviews" />
          <Tab value="requests" label="Requests" />
          <Tab value="video" label="Video Reviews" />
        </Tabs>

        {pageTab === 'reviews' && (
          <div className="space-y-8">
            {!connected && <ConnectBanner />}
            <OtherPlatformsPanel />
            {stats && <StatsHeader stats={stats} />}
            <ReviewFeed />
          </div>
        )}

        {pageTab === 'requests' && <RequestsPanel />}

        {pageTab === 'video' && <VideoReviewsTab />}
      </div>
    </div>
  )
}
