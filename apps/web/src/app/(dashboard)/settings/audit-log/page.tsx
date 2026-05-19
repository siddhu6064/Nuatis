'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface AuditItem {
  id: string
  created_at: string
  action: string
  resource_type: string | null
  entity_id: string | null
  actor_type: string | null
  actor_id: string | null
  ip_address: string | null
  metadata: Record<string, unknown> | null
}

interface ApiResponse {
  items: AuditItem[]
  total: number
  page: number
  pages: number
}

const ACTION_BADGE: Record<string, string> = {
  created: 'bg-green-50 text-green-700 border-green-200',
  updated: 'bg-blue-50 text-blue-700 border-blue-200',
  deleted: 'bg-rose-50 text-rose-700 border-rose-200',
  exported: 'bg-purple-50 text-purple-700 border-purple-200',
  imported: 'bg-amber-50 text-amber-700 border-amber-200',
  login: 'bg-teal-50 text-teal-700 border-teal-200',
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  )
}

function detailsText(item: AuditItem): string {
  if (!item.metadata) return '—'
  const m = item.metadata
  if (typeof m['description'] === 'string') return m['description']
  if (typeof m['details'] === 'string') return m['details']
  const entries = Object.entries(m)
  if (entries.length === 0) return '—'
  return entries
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ')
}

function exportCSV(items: AuditItem[]) {
  const headers = [
    'Timestamp',
    'Actor ID',
    'Actor Type',
    'Action',
    'Resource Type',
    'Entity ID',
    'IP Address',
    'Details',
  ]
  const rows = items.map((item) => [
    new Date(item.created_at).toISOString(),
    item.actor_id ?? '',
    item.actor_type ?? '',
    item.action,
    item.resource_type ?? '',
    item.entity_id ?? '',
    item.ip_address ?? '',
    detailsText(item).replace(/,/g, ';'),
  ])
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ShieldIcon() {
  return (
    <svg
      className="w-8 h-8 text-ink4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      />
    </svg>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-gray-100 rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(
    async (opts: { search: string; action: string; resource: string; page: number }) => {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('page', String(opts.page))
      if (opts.search) params.set('search', opts.search)
      if (opts.action) params.set('action', opts.action)
      if (opts.resource) params.set('resource_type', opts.resource)
      try {
        const res = await fetch(`/api/audit-log?${params}`, { credentials: 'include' })
        if (res.ok) {
          const data = (await res.json()) as ApiResponse
          setItems(data.items)
          setTotal(data.total)
        }
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchData({ search, action: actionFilter, resource: resourceFilter, page })
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, actionFilter, resourceFilter, page, fetchData])

  function handleFilterChange(newSearch: string, newAction: string, newResource: string) {
    setPage(1)
    setSearch(newSearch)
    setActionFilter(newAction)
    setResourceFilter(newResource)
  }

  const startRow = (page - 1) * PAGE_SIZE + 1
  const endRow = Math.min(page * PAGE_SIZE, total)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Audit Log</h1>
        <p className="text-sm text-ink3 mt-0.5">
          All account activity, filterable by user, action, and resource.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => handleFilterChange(e.target.value, actionFilter, resourceFilter)}
          placeholder="Search by resource or action…"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
        />
        <select
          value={actionFilter}
          onChange={(e) => handleFilterChange(search, e.target.value, resourceFilter)}
          className="px-3 py-2 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 text-ink2 bg-white"
        >
          <option value="">All Actions</option>
          <option value="created">created</option>
          <option value="updated">updated</option>
          <option value="deleted">deleted</option>
          <option value="exported">exported</option>
          <option value="imported">imported</option>
          <option value="login">login</option>
        </select>
        <select
          value={resourceFilter}
          onChange={(e) => handleFilterChange(search, actionFilter, e.target.value)}
          className="px-3 py-2 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 text-ink2 bg-white"
        >
          <option value="">All Resources</option>
          <option value="contact">contact</option>
          <option value="deal">deal</option>
          <option value="appointment">appointment</option>
          <option value="quote">quote</option>
          <option value="pipeline">pipeline</option>
          <option value="user">user</option>
          <option value="settings">settings</option>
        </select>
        <button
          onClick={() => exportCSV(items)}
          disabled={items.length === 0}
          className="ml-auto px-3 py-2 text-sm font-medium border border-teal-600 text-teal-700 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {loading ? (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                {['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Details'].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-ink4 px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <ShieldIcon />
            <p className="text-sm font-medium text-ink4">No audit events found</p>
            <p className="text-xs text-gray-300">Try adjusting your filters</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                {['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Details'].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-ink4 px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const badgeClass =
                  ACTION_BADGE[item.action] ?? 'bg-bg2 text-ink3 border-border-brand'
                return (
                  <tr
                    key={item.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-ink3 whitespace-nowrap">
                      {formatTimestamp(item.created_at)}
                    </td>
                    <td
                      className="px-4 py-3 text-xs text-ink3 font-mono max-w-[120px] truncate"
                      title={item.actor_id ?? ''}
                    >
                      {item.actor_id ? item.actor_id.slice(0, 8) + '…' : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${badgeClass}`}
                      >
                        {item.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink2">{item.resource_type ?? '—'}</td>
                    <td
                      className="px-4 py-3 text-xs text-ink4 font-mono"
                      title={item.entity_id ?? ''}
                    >
                      {item.entity_id ? item.entity_id.slice(0, 8) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink3 max-w-[200px] truncate">
                      {detailsText(item)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-brand">
            <p className="text-xs text-ink4">
              Showing {startRow}–{endRow} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border-brand text-ink3 hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border-brand text-ink3 hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
