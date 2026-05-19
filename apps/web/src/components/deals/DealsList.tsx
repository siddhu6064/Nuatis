'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

const TAG_COLORS = [
  'bg-teal-50 text-teal-700 border-teal-200',
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-purple-50 text-purple-700 border-purple-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-green-50 text-green-700 border-green-200',
]

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!
}

interface Pipeline {
  id: string
  name: string
  is_default: boolean
  pipeline_type: string
  stage_count: number
}

interface Stage {
  id: string
  name: string
  color: string
  position: number
}

interface Deal {
  id: string
  title: string
  value: number
  pipeline_stage_id: string | null
  contact_name: string | null
  company_name: string | null
  close_date: string | null
  probability: number
  is_closed_won: boolean
  is_closed_lost: boolean
  stage_name: string | null
  stage_color: string | null
  source?: string | null
  updated_at?: string | null
  created_at?: string | null
  tags?: string[]
}

type SortCol = 'title' | 'value' | 'stage_name' | 'source' | 'updated_at' | null

const PAGE_SIZE = 25

function formatValue(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return `$${v.toFixed(0)}`
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export default function DealsList({ viewToggle }: { viewToggle?: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(
    searchParams.get('pipeline')
  )
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  const [sortCol, setSortCol] = useState<SortCol>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [page, setPage] = useState(1)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newCloseDate, setNewCloseDate] = useState('')
  const [newProbability, setNewProbability] = useState('50')
  const [saving, setSaving] = useState(false)

  // Contact search
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<
    { id: string; full_name: string; email: string | null }[]
  >([])
  const [selectedContact, setSelectedContact] = useState<{ id: string; full_name: string } | null>(
    null
  )
  const [contactDropOpen, setContactDropOpen] = useState(false)
  const contactSearchRef = useRef<HTMLDivElement>(null)
  const contactDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pipelines?type=deals`, { credentials: 'include' })
        if (res.ok) {
          const payload = (await res.json()) as { pipelines?: Pipeline[] } | Pipeline[]
          const data: Pipeline[] = Array.isArray(payload) ? payload : (payload.pipelines ?? [])
          setPipelines(data)
          const paramId = searchParams.get('pipeline')
          if (paramId && data.find((p) => p.id === paramId)) {
            setActivePipelineId(paramId)
          } else {
            const def = data.find((p) => p.is_default) ?? data[0]
            if (def) setActivePipelineId(def.id)
          }
          if (data.length === 0) setLoading(false)
        } else {
          setLoading(false)
        }
      } catch {
        setActivePipelineId('__legacy__')
      }
    })()
  }, [])

  const fetchData = useCallback(async (pipelineId: string) => {
    setLoading(true)
    try {
      const stagesUrl =
        pipelineId === '__legacy__' ? `/api/contacts/stages` : `/api/pipelines/${pipelineId}`
      const dealsUrl =
        pipelineId === '__legacy__' ? `/api/deals` : `/api/deals?pipeline_id=${pipelineId}`

      const [stagesRes, dealsRes] = await Promise.all([
        fetch(stagesUrl, { credentials: 'include' }),
        fetch(dealsUrl, { credentials: 'include' }),
      ])

      if (stagesRes.ok) {
        const data = (await stagesRes.json()) as { stages: Stage[] }
        const list = 'stages' in data ? data.stages : []
        setStages(list.sort((a, b) => a.position - b.position))
      }

      if (dealsRes.ok) {
        const data = (await dealsRes.json()) as { deals: Deal[] }
        setDeals(data.deals ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activePipelineId) return
    void fetchData(activePipelineId)
  }, [activePipelineId, fetchData])

  // Close contact dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (contactSearchRef.current && !contactSearchRef.current.contains(e.target as Node)) {
        setContactDropOpen(false)
      }
    }
    if (contactDropOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contactDropOpen])

  // Close ··· menu on outside click
  useEffect(() => {
    if (!openMenu) return
    function handler(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-menu]')) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  function handleContactSearch(q: string) {
    setContactSearch(q)
    setSelectedContact(null)
    if (contactDebounce.current) clearTimeout(contactDebounce.current)
    if (!q.trim()) {
      setContactResults([])
      setContactDropOpen(false)
      return
    }
    contactDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}&limit=8`, {
          credentials: 'include',
        })
        if (res.ok) {
          const data = (await res.json()) as {
            contacts?: { id: string; full_name: string; email: string | null }[]
          }
          setContactResults(data.contacts ?? [])
          setContactDropOpen(true)
        }
      } catch {
        // ignore
      }
    }, 250)
  }

  function switchPipeline(id: string) {
    setActivePipelineId(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set('pipeline', id)
    router.replace(`/deals?${params.toString()}`)
  }

  function cycleSort(col: SortCol) {
    setPage(1)
    if (sortCol !== col) {
      setSortCol(col)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortCol(null)
      setSortDir(null)
    }
  }

  async function markWon(id: string) {
    setOpenMenu(null)
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_closed_won: true, is_closed_lost: false } : d))
    )
    await fetch(`/api/deals/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_closed_won: true, is_closed_lost: false }),
    })
  }

  async function markLost(id: string) {
    setOpenMenu(null)
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_closed_lost: true, is_closed_won: false } : d))
    )
    await fetch(`/api/deals/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_closed_lost: true, is_closed_won: false }),
    })
  }

  async function deleteDeal(id: string) {
    setOpenMenu(null)
    setDeals((prev) => prev.filter((d) => d.id !== id))
    await fetch(`/api/deals/${id}`, { method: 'DELETE', credentials: 'include' })
  }

  const createDeal = async () => {
    if (!newTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/deals`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          value: parseFloat(newValue) || 0,
          close_date: newCloseDate || undefined,
          probability: parseInt(newProbability) || 50,
          pipeline_stage_id: stages[0]?.id,
          pipeline_id: activePipelineId !== '__legacy__' ? activePipelineId : undefined,
          contact_id: selectedContact?.id ?? null,
        }),
      })
      if (res.ok) {
        setNewTitle('')
        setNewValue('')
        setNewCloseDate('')
        setNewProbability('50')
        setContactSearch('')
        setSelectedContact(null)
        setContactResults([])
        setShowCreate(false)
        if (activePipelineId) void fetchData(activePipelineId)
      }
    } finally {
      setSaving(false)
    }
  }

  // Sort
  const sorted = [...deals].sort((a, b) => {
    if (!sortCol || !sortDir) return 0
    let av: string | number | null = null
    let bv: string | number | null = null
    if (sortCol === 'title') {
      av = a.title
      bv = b.title
    } else if (sortCol === 'value') {
      av = Number(a.value)
      bv = Number(b.value)
    } else if (sortCol === 'stage_name') {
      av = a.stage_name ?? ''
      bv = b.stage_name ?? ''
    } else if (sortCol === 'source') {
      av = a.source ?? ''
      bv = b.source ?? ''
    } else if (sortCol === 'updated_at') {
      av = a.updated_at ?? ''
      bv = b.updated_at ?? ''
    }
    if (av === null || bv === null) return 0
    const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const total = sorted.length
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const activeDeals = deals.filter((d) => !d.is_closed_won && !d.is_closed_lost)

  function SortArrow({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="ml-1 text-ink4 opacity-40">⇅</span>
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function Th({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) {
    return (
      <th
        className={`px-4 py-2.5 text-left text-xs font-semibold text-ink3 cursor-pointer select-none hover:text-ink2 whitespace-nowrap ${className}`}
        onClick={() => cycleSort(col)}
      >
        {label}
        <SortArrow col={col} />
      </th>
    )
  }

  if (loading) return <div className="px-8 py-8 text-center text-sm text-ink4">Loading...</div>

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Deals</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {activeDeals.length} active deals
            {' · '}
            {formatValue(activeDeals.reduce((s, d) => s + Number(d.value), 0))} pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          {viewToggle}
          <Link
            href="/settings/pipelines"
            className="text-xs text-ink3 hover:text-ink2 underline underline-offset-2"
          >
            Manage Pipelines
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            New Deal
          </button>
        </div>
      </div>

      {/* Pipeline tabs */}
      {pipelines.length > 0 && (
        <div className="flex items-center gap-1 mb-5 shrink-0 border-b border-border-brand pb-0">
          {pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => switchPipeline(p.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
                activePipelineId === p.id
                  ? 'border-teal-600 text-teal-700 bg-teal-50'
                  : 'border-transparent text-ink3 hover:text-ink2 hover:bg-bg'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-4 shrink-0">
          <p className="text-xs text-ink4 mb-3">
            Deals track individual opportunities. A contact can have multiple deals.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Deal title *"
              autoFocus
              className="text-sm border border-border-brand rounded px-3 py-2 col-span-2"
            />
            <input
              type="number"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Value ($)"
              className="text-sm border border-border-brand rounded px-3 py-2"
            />
            <input
              type="date"
              value={newCloseDate}
              onChange={(e) => setNewCloseDate(e.target.value)}
              className="text-sm border border-border-brand rounded px-3 py-2"
            />
            <input
              type="number"
              value={newProbability}
              onChange={(e) => setNewProbability(e.target.value)}
              placeholder="Probability (%)"
              min="0"
              max="100"
              className="text-sm border border-border-brand rounded px-3 py-2"
            />
          </div>

          <div className="relative mb-3" ref={contactSearchRef}>
            <input
              type="text"
              value={selectedContact ? selectedContact.full_name : contactSearch}
              onChange={(e) => handleContactSearch(e.target.value)}
              onFocus={() => contactResults.length > 0 && setContactDropOpen(true)}
              placeholder="Search contacts... (optional)"
              className="w-full text-sm border border-border-brand rounded px-3 py-2"
            />
            {selectedContact && (
              <button
                type="button"
                onClick={() => {
                  setSelectedContact(null)
                  setContactSearch('')
                  setContactResults([])
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink4 hover:text-ink3 text-lg leading-none"
              >
                ×
              </button>
            )}
            {contactDropOpen && contactResults.length > 0 && (
              <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {contactResults.map((c) => (
                  <li
                    key={c.id}
                    onMouseDown={() => {
                      setSelectedContact({ id: c.id, full_name: c.full_name })
                      setContactSearch('')
                      setContactResults([])
                      setContactDropOpen(false)
                    }}
                    className="px-3 py-2 text-sm hover:bg-bg cursor-pointer"
                  >
                    <span className="font-medium text-ink">{c.full_name}</span>
                    {c.email && <span className="ml-2 text-xs text-ink4">{c.email}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-ink3">
              Cancel
            </button>
            <button
              onClick={() => void createDeal()}
              disabled={!newTitle.trim() || saving}
              className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Deal'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-border-brand">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg2 border-b border-border-brand">
            <tr>
              <Th col="title" label="Name" />
              <Th col="value" label="Value" />
              <Th col="stage_name" label="Stage" />
              <Th col="source" label="Source" />
              <Th col="updated_at" label="Last Activity" />
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink3">Tags</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-brand bg-white">
            {paged.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink4">
                  No deals
                </td>
              </tr>
            ) : (
              paged.map((deal) => (
                <tr
                  key={deal.id}
                  className={`cursor-pointer hover:bg-bg transition-colors ${
                    deal.is_closed_won ? 'bg-green-50/30' : deal.is_closed_lost ? 'opacity-70' : ''
                  }`}
                  onClick={() => router.push(`/deals/${deal.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink truncate max-w-[200px]">{deal.title}</p>
                    {(deal.contact_name || deal.company_name) && (
                      <p className="text-xs text-ink4 truncate max-w-[200px]">
                        {deal.contact_name}
                        {deal.contact_name && deal.company_name ? ' · ' : ''}
                        {deal.company_name}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-teal-600 whitespace-nowrap">
                    {formatValue(Number(deal.value))}
                  </td>
                  <td className="px-4 py-3">
                    {deal.stage_name ? (
                      <span className="bg-bg2 text-ink3 rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
                        {deal.stage_name}
                      </span>
                    ) : (
                      <span className="text-ink4">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink3 text-xs">{deal.source ?? '—'}</td>
                  <td className="px-4 py-3 text-ink4 text-xs whitespace-nowrap">
                    {formatRelative(deal.updated_at ?? deal.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {deal.tags && deal.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {deal.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${tagColorClass(tag)}`}
                          >
                            {tag}
                          </span>
                        ))}
                        {deal.tags.length > 2 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg2 text-ink4 border border-border-brand">
                            +{deal.tags.length - 2}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink4">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="relative" data-menu>
                      <button
                        className="p-1 rounded hover:bg-bg2 text-ink3 hover:text-ink leading-none"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenMenu(openMenu === deal.id ? null : deal.id)
                        }}
                      >
                        ···
                      </button>
                      {openMenu === deal.id && (
                        <div className="absolute right-0 top-full z-50 mt-1 bg-white border border-border-brand rounded-lg shadow-lg w-36 py-1">
                          <button
                            className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-bg"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/deals/${deal.id}`)
                            }}
                          >
                            Edit
                          </button>
                          {!deal.is_closed_won && (
                            <button
                              className="w-full text-left px-3 py-1.5 text-xs text-green-700 hover:bg-bg"
                              onClick={(e) => {
                                e.stopPropagation()
                                void markWon(deal.id)
                              }}
                            >
                              Mark Won
                            </button>
                          )}
                          {!deal.is_closed_lost && (
                            <button
                              className="w-full text-left px-3 py-1.5 text-xs text-ink3 hover:bg-bg"
                              onClick={(e) => {
                                e.stopPropagation()
                                void markLost(deal.id)
                              }}
                            >
                              Mark Lost
                            </button>
                          )}
                          <button
                            className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-bg"
                            onClick={(e) => {
                              e.stopPropagation()
                              void deleteDeal(deal.id)
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-3 border-t border-border-brand mt-3 shrink-0">
          <span className="text-xs text-ink4">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1.5 text-xs rounded border border-border-brand text-ink3 hover:bg-bg2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-xs text-ink4 px-2">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 text-xs rounded border border-border-brand text-ink3 hover:bg-bg2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
