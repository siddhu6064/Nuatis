'use client'

import { useState, useEffect } from 'react'
import type { MayaKbUrl } from '@nuatis/shared'

const STATUS_CLASSES: Record<MayaKbUrl['status'], string> = {
  pending: 'bg-amber-50 text-amber-600',
  crawling: 'bg-blue-50 text-blue-600',
  ready: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-600',
}

const STATUS_LABEL: Record<MayaKbUrl['status'], string> = {
  pending: 'Pending',
  crawling: 'Crawling…',
  ready: 'Ready',
  error: 'Error',
}

function truncateUrl(url: string, maxLen = 50): string {
  return url.length > maxLen ? url.slice(0, maxLen) + '…' : url
}

export default function WebsiteKnowledgeCard({ initialUrls }: { initialUrls: MayaKbUrl[] }) {
  const [urls, setUrls] = useState<MayaKbUrl[]>(initialUrls)
  const [inputUrl, setInputUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const hasInFlight = urls.some((u) => u.status === 'pending' || u.status === 'crawling')

  // Auto-refresh every 5s if any URL is pending/crawling
  useEffect(() => {
    if (!hasInFlight) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/maya-kb/urls', { credentials: 'include' })
        if (res.ok) {
          const data = (await res.json()) as { urls: MayaKbUrl[] }
          setUrls(data.urls)
        }
      } catch {
        // silent
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [hasInFlight])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = inputUrl.trim()
    if (!trimmed) return

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setAddError('URL must start with http:// or https://')
      return
    }

    setAdding(true)
    setAddError(null)

    try {
      const res = await fetch('/api/maya-kb/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        credentials: 'include',
      })
      const data = (await res.json()) as {
        error?: string
        id?: string
        tenant_id?: string
        url?: string
        status?: string
        pages_crawled?: number
        last_crawled_at?: string | null
        created_at?: string
        updated_at?: string
      }
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add URL')
        return
      }
      setUrls((prev) => [
        {
          id: data.id!,
          tenant_id: data.tenant_id ?? '',
          url: data.url!,
          status: 'pending',
          pages_crawled: 0,
          extracted_text: null,
          error_message: null,
          last_crawled_at: null,
          created_at: data.created_at ?? new Date().toISOString(),
          updated_at: data.updated_at ?? new Date().toISOString(),
        },
        ...prev,
      ])
      setInputUrl('')
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this URL from Maya's knowledge base?")) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/maya-kb/urls/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setUrls((prev) => prev.filter((u) => u.id !== id))
        setDeleteError(null)
      } else {
        setDeleteError('Failed to remove URL')
      }
    } catch {
      setDeleteError('Failed to remove URL')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRefresh(id: string) {
    setRefreshingId(id)
    try {
      const res = await fetch(`/api/maya-kb/urls/${id}/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setUrls((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: 'pending', error_message: null } : u))
        )
        setRefreshError(null)
      } else {
        setRefreshError('Failed to refresh URL')
      }
    } catch {
      setRefreshError('Failed to refresh URL')
    } finally {
      setRefreshingId(null)
    }
  }

  const atMax = urls.length >= 3

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 mt-6">
      <div className="mb-1">
        <h2 className="text-sm font-semibold text-ink">Website Knowledge</h2>
      </div>
      <p className="text-xs text-ink4 mb-4">
        Add up to 3 website URLs. Maya will crawl their content and use it to answer caller
        questions.
      </p>

      {!atMax && (
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            type="url"
            aria-label="Website URL"
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value)
              setAddError(null)
            }}
            placeholder="https://yourbusiness.com"
            className="flex-1 px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white text-ink placeholder:text-ink4"
            disabled={adding}
          />
          <button
            type="submit"
            disabled={adding || !inputUrl.trim()}
            className="px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding…' : 'Crawl Website'}
          </button>
        </form>
      )}

      {addError && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">{addError}</div>
      )}
      {deleteError && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
          {deleteError}
        </div>
      )}
      {refreshError && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
          {refreshError}
        </div>
      )}

      {urls.length === 0 ? (
        <p className="text-sm text-ink4">No URLs added yet.</p>
      ) : (
        <div className="space-y-2">
          {urls.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between py-2 px-3 bg-bg rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-ink truncate max-w-[240px]" title={u.url}>
                  {truncateUrl(u.url)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASSES[u.status]}`}
                >
                  {STATUS_LABEL[u.status]}
                </span>
                {u.status === 'ready' && u.pages_crawled > 0 && (
                  <span className="text-xs text-ink4 shrink-0">
                    {u.pages_crawled} page{u.pages_crawled !== 1 ? 's' : ''}
                  </span>
                )}
                {u.status === 'error' && u.error_message && (
                  <span
                    className="text-xs text-red-500 truncate max-w-[140px]"
                    title={u.error_message}
                  >
                    {u.error_message}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 ml-3 shrink-0">
                {/* Refresh button — shown for ready or error states */}
                {(u.status === 'ready' || u.status === 'error') && (
                  <button
                    type="button"
                    onClick={() => handleRefresh(u.id)}
                    disabled={refreshingId === u.id}
                    title="Re-crawl"
                    className="text-ink4 hover:text-brand transition-colors disabled:opacity-40 p-0.5"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  </button>
                )}
                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleDelete(u.id)}
                  disabled={deletingId === u.id}
                  title="Remove"
                  className="text-ink4 hover:text-red-500 transition-colors disabled:opacity-40 p-0.5"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {atMax && <p className="text-xs text-ink4 mt-3">Maximum 3 URLs reached.</p>}
    </div>
  )
}
