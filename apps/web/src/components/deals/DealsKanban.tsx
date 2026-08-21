'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'

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
  description: string | null
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
  tags?: string[]
}

function formatValue(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return `$${v.toFixed(0)}`
}

function closeDateStatus(d: string | null): 'overdue' | 'soon' | 'ok' | null {
  if (!d) return null
  const diff = new Date(d).getTime() - Date.now()
  if (diff < 0) return 'overdue'
  if (diff < 7 * 86400000) return 'soon'
  return 'ok'
}

export default function DealsKanban({ viewToggle }: { viewToggle?: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(
    searchParams.get('pipeline')
  )
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

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

  // Fetch pipelines on mount
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
        // silently fail — fallback to old behaviour below
        setActivePipelineId('__legacy__')
      }
    })()
  }, [])

  const fetchBoardData = useCallback(async (pipelineId: string) => {
    setLoading(true)
    try {
      let stagesUrl: string
      let dealsUrl: string

      if (pipelineId === '__legacy__') {
        // Fallback: use old stages endpoint when no pipelines API available
        stagesUrl = `/api/contacts/stages`
        dealsUrl = `/api/deals`
      } else {
        stagesUrl = `/api/pipelines/${pipelineId}`
        dealsUrl = `/api/deals?pipeline_id=${pipelineId}`
      }

      const [stagesRes, dealsRes] = await Promise.all([
        fetch(stagesUrl, { credentials: 'include' }),
        fetch(dealsUrl, { credentials: 'include' }),
      ])

      if (stagesRes.ok) {
        const data = (await stagesRes.json()) as
          | { stages: Stage[] }
          | { id: string; name: string; stages: Stage[] }
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
    void fetchBoardData(activePipelineId)
  }, [activePipelineId, fetchBoardData])

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

  const switchPipeline = (id: string) => {
    setActivePipelineId(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set('pipeline', id)
    router.replace(`/deals?${params.toString()}`)
  }

  const moveDeal = async (dealId: string, stageId: string) => {
    // Optimistic update
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, pipeline_stage_id: stageId } : d))
    )
    await fetch(`/api/deals/${dealId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline_stage_id: stageId }),
    })
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
        if (activePipelineId) void fetchBoardData(activePipelineId)
      }
    } finally {
      setSaving(false)
    }
  }

  // Group deals by stage
  const grouped = new Map<string, Deal[]>()
  for (const stage of stages) grouped.set(stage.id, [])
  for (const deal of deals) {
    if (deal.pipeline_stage_id && grouped.has(deal.pipeline_stage_id)) {
      grouped.get(deal.pipeline_stage_id)!.push(deal)
    } else if (stages[0]) {
      grouped.get(stages[0].id)?.push(deal)
    }
  }

  if (loading) return <div className="px-8 py-8 text-center text-sm text-ink4">Loading...</div>

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Deals</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {deals.filter((d) => !d.is_closed_won && !d.is_closed_lost).length} active deals
            {' \u00B7 '}
            {formatValue(
              deals
                .filter((d) => !d.is_closed_won && !d.is_closed_lost)
                .reduce((s, d) => s + Number(d.value), 0)
            )}{' '}
            pipeline
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
          <Button onClick={() => setShowCreate(true)} variant="contained">
            + New Deal
          </Button>
        </div>
      </div>

      {/* Pipeline tab bar */}
      {pipelines.length > 0 && (
        <div className="mb-5 shrink-0 border-b border-border-brand pb-0">
          <ToggleButtonGroup
            value={activePipelineId}
            exclusive
            onChange={(_e, value: string | null) => value && switchPipeline(value)}
            size="small"
          >
            {pipelines.map((p) => (
              <ToggleButton key={p.id} value={p.id}>
                {p.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-4 shrink-0">
          <p className="text-xs text-ink4 mb-3">
            Deals track individual opportunities. A contact can have multiple deals.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <TextField
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Deal title *"
              autoFocus
              size="small"
              className="col-span-2"
            />
            <TextField
              type="number"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Value ($)"
              size="small"
            />
            <TextField
              type="date"
              value={newCloseDate}
              onChange={(e) => setNewCloseDate(e.target.value)}
              size="small"
            />
            <TextField
              type="number"
              value={newProbability}
              onChange={(e) => setNewProbability(e.target.value)}
              placeholder="Probability (%)"
              slotProps={{ htmlInput: { min: 0, max: 100 } }}
              size="small"
            />
          </div>

          {/* Contact search */}
          <div className="relative mb-3" ref={contactSearchRef}>
            <TextField
              value={selectedContact ? selectedContact.full_name : contactSearch}
              onChange={(e) => handleContactSearch(e.target.value)}
              onFocus={() => contactResults.length > 0 && setContactDropOpen(true)}
              placeholder="Search contacts... (optional)"
              fullWidth
              size="small"
            />
            {selectedContact && (
              <IconButton
                onClick={() => {
                  setSelectedContact(null)
                  setContactSearch('')
                  setContactResults([])
                }}
                size="small"
                aria-label="Clear selected contact"
                sx={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              >
                <span className="text-sm leading-none">&times;</span>
              </IconButton>
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
            <Button onClick={() => setShowCreate(false)} size="small" color="inherit">
              Cancel
            </Button>
            <Button
              onClick={() => void createDeal()}
              disabled={!newTitle.trim() || saving}
              size="small"
              variant="contained"
            >
              {saving ? 'Creating...' : 'Create Deal'}
            </Button>
          </div>
        </div>
      )}

      {/* Kanban */}
      <div className="overflow-x-auto flex-1">
        <div className="flex gap-4 h-full pb-4" style={{ minWidth: `${stages.length * 272}px` }}>
          {stages.map((stage) => {
            const cards = grouped.get(stage.id) ?? []
            const stageValue = cards.reduce((s, d) => s + Number(d.value), 0)

            return (
              <div key={stage.id} className="w-64 shrink-0 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-xs font-semibold text-ink2 truncate">{stage.name}</span>
                  <span className="ml-auto text-xs font-medium text-ink4 bg-bg2 px-1.5 py-0.5 rounded-full">
                    {cards.length}
                  </span>
                </div>
                {stageValue > 0 && (
                  <p className="text-[10px] text-ink4 mb-2">{formatValue(stageValue)}</p>
                )}

                <div className="flex flex-col gap-2 flex-1">
                  {cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border-brand px-4 py-6 text-center">
                      <p className="text-xs text-gray-300">No deals</p>
                    </div>
                  ) : (
                    cards.map((deal) => {
                      const dateStatus = closeDateStatus(deal.close_date)
                      return (
                        <div
                          key={deal.id}
                          className="bg-white rounded-xl border border-border-brand px-4 py-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => router.push(`/deals/${deal.id}`)}
                        >
                          <p className="text-sm font-medium text-ink truncate mb-1">{deal.title}</p>
                          <p className="text-sm font-semibold text-teal-600 mb-1">
                            {formatValue(Number(deal.value))}
                          </p>
                          {(deal.contact_name || deal.company_name) && (
                            <p className="text-[11px] text-ink4 truncate mb-1">
                              {deal.contact_name}
                              {deal.contact_name && deal.company_name ? ' \u00B7 ' : ''}
                              {deal.company_name}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            {deal.close_date && (
                              <span
                                className={`text-[10px] ${dateStatus === 'overdue' ? 'text-red-600 font-medium' : dateStatus === 'soon' ? 'text-amber-600' : 'text-ink4'}`}
                              >
                                {new Date(deal.close_date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            )}
                            <span className="text-[10px] text-ink4 bg-bg2 px-1 py-0.5 rounded">
                              {deal.probability}%
                            </span>
                          </div>
                          {/* Stage selector */}
                          <TextField
                            select
                            fullWidth
                            value={deal.pipeline_stage_id ?? ''}
                            onChange={(e) => {
                              void moveDeal(deal.id, e.target.value)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            sx={{ mt: 1 }}
                            slotProps={{ select: { sx: { fontSize: 10, py: 0.5 } } }}
                          >
                            {stages.map((s) => (
                              <MenuItem key={s.id} value={s.id} sx={{ fontSize: 12 }}>
                                {s.name}
                              </MenuItem>
                            ))}
                          </TextField>
                          {/* Tag chips */}
                          {deal.tags && deal.tags.length > 0 && (
                            <div
                              className="flex flex-wrap gap-1 mt-2"
                              onClick={(e) => e.stopPropagation()}
                            >
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
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
