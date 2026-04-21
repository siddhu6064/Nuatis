'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

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

export default function DealsKanban() {
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

  // Fetch pipelines on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pipelines?type=deals`, { credentials: 'include' })
        if (res.ok) {
          const data = (await res.json()) as Pipeline[]
          setPipelines(data)
          const paramId = searchParams.get('pipeline')
          if (paramId && data.find((p) => p.id === paramId)) {
            setActivePipelineId(paramId)
          } else {
            const def = data.find((p) => p.is_default) ?? data[0]
            if (def) setActivePipelineId(def.id)
          }
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
        }),
      })
      if (res.ok) {
        setNewTitle('')
        setNewValue('')
        setNewCloseDate('')
        setNewProbability('50')
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

  if (loading) return <div className="px-8 py-8 text-center text-sm text-gray-400">Loading...</div>

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Deals</h1>
          <p className="text-sm text-gray-500 mt-0.5">
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
          <Link
            href="/settings/pipelines"
            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
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

      {/* Pipeline tab bar */}
      {pipelines.length > 0 && (
        <div className="flex items-center gap-1 mb-5 shrink-0 border-b border-gray-100 pb-0">
          {pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => switchPipeline(p.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px ${
                activePipelineId === p.id
                  ? 'border-teal-600 text-teal-700 bg-teal-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 shrink-0">
          <p className="text-xs text-gray-400 mb-3">
            Deals track individual opportunities. A contact can have multiple deals.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Deal title *"
              autoFocus
              className="text-sm border border-gray-200 rounded px-3 py-2 col-span-2"
            />
            <input
              type="number"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Value ($)"
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
            <input
              type="date"
              value={newCloseDate}
              onChange={(e) => setNewCloseDate(e.target.value)}
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
            <input
              type="number"
              value={newProbability}
              onChange={(e) => setNewProbability(e.target.value)}
              placeholder="Probability (%)"
              min="0"
              max="100"
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs text-gray-500"
            >
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
                  <span className="text-xs font-semibold text-gray-700 truncate">{stage.name}</span>
                  <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {cards.length}
                  </span>
                </div>
                {stageValue > 0 && (
                  <p className="text-[10px] text-gray-400 mb-2">{formatValue(stageValue)}</p>
                )}

                <div className="flex flex-col gap-2 flex-1">
                  {cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
                      <p className="text-xs text-gray-300">No deals</p>
                    </div>
                  ) : (
                    cards.map((deal) => {
                      const dateStatus = closeDateStatus(deal.close_date)
                      return (
                        <div
                          key={deal.id}
                          className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => router.push(`/deals/${deal.id}`)}
                        >
                          <p className="text-sm font-medium text-gray-900 truncate mb-1">
                            {deal.title}
                          </p>
                          <p className="text-sm font-semibold text-teal-600 mb-1">
                            {formatValue(Number(deal.value))}
                          </p>
                          {(deal.contact_name || deal.company_name) && (
                            <p className="text-[11px] text-gray-400 truncate mb-1">
                              {deal.contact_name}
                              {deal.contact_name && deal.company_name ? ' \u00B7 ' : ''}
                              {deal.company_name}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            {deal.close_date && (
                              <span
                                className={`text-[10px] ${dateStatus === 'overdue' ? 'text-red-600 font-medium' : dateStatus === 'soon' ? 'text-amber-600' : 'text-gray-400'}`}
                              >
                                {new Date(deal.close_date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            )}
                            <span className="text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded">
                              {deal.probability}%
                            </span>
                          </div>
                          {/* Stage selector */}
                          <select
                            value={deal.pipeline_stage_id ?? ''}
                            onChange={(e) => {
                              e.stopPropagation()
                              void moveDeal(deal.id, e.target.value)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500"
                          >
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
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
