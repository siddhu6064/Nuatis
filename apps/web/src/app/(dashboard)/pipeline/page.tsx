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
  position: number
  color: string
  contact_count?: number
}

interface Contact {
  id: string
  full_name: string
  email: string | null
  pipeline_stage: string | null
  lifecycle_stage: string | null
  lead_score: number | null
  lead_grade: string | null
}

const gradeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-orange-100 text-orange-700',
  F: 'bg-red-100 text-red-700',
}

const lifecycleColors: Record<string, string> = {
  subscriber: 'bg-gray-100 text-gray-600',
  lead: 'bg-blue-100 text-blue-700',
  marketing_qualified: 'bg-purple-100 text-purple-700',
  sales_qualified: 'bg-orange-100 text-orange-700',
  opportunity: 'bg-yellow-100 text-yellow-700',
  customer: 'bg-green-100 text-green-700',
  evangelist: 'bg-emerald-100 text-emerald-700',
  other: 'bg-gray-100 text-gray-600',
}

const lifecycleLabel: Record<string, string> = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  marketing_qualified: 'MQL',
  sales_qualified: 'SQL',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
  other: 'Other',
}

export default function PipelinePage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string | null>(
    searchParams.get('pipeline')
  )
  const [stages, setStages] = useState<Stage[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [movingContact, setMovingContact] = useState<string | null>(null)

  // Fetch pipelines list on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pipelines?type=contacts`, {
          credentials: 'include',
        })
        if (res.ok) {
          const payload = (await res.json()) as { pipelines?: Pipeline[] } | Pipeline[]
          const data: Pipeline[] = Array.isArray(payload) ? payload : (payload.pipelines ?? [])
          setPipelines(data)
          // Determine initial active pipeline
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
        // silently fail — board stays empty
        setLoading(false)
      }
    })()
  }, [])

  // Fetch stages + contacts whenever active pipeline changes
  const fetchBoardData = useCallback(async (pipelineId: string) => {
    setLoading(true)
    try {
      const [stagesRes, contactsRes] = await Promise.all([
        fetch(`/api/pipelines/${pipelineId}`, { credentials: 'include' }),
        fetch(`/api/contacts?pipeline_id=${pipelineId}`, { credentials: 'include' }),
      ])

      if (stagesRes.ok) {
        const data = (await stagesRes.json()) as { id: string; name: string; stages: Stage[] }
        setStages((data.stages ?? []).sort((a, b) => a.position - b.position))
      }

      if (contactsRes.ok) {
        const data = (await contactsRes.json()) as { contacts: Contact[] }
        setContacts(data.contacts ?? [])
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
    router.replace(`/pipeline?${params.toString()}`)
  }

  const moveContact = async (contactId: string, stageName: string) => {
    setMovingContact(contactId)
    // Optimistic update
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, pipeline_stage: stageName } : c))
    )
    try {
      await fetch(`/api/contacts/${contactId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: stageName }),
      })
    } finally {
      setMovingContact(null)
    }
  }

  const activePipeline = pipelines.find((p) => p.id === activePipelineId)

  // Group contacts by stage name
  const defaultStage = stages[0]?.name ?? ''
  const grouped = new Map<string, Contact[]>()
  for (const stage of stages) grouped.set(stage.name, [])
  for (const contact of contacts) {
    const stage = contact.pipeline_stage ?? defaultStage
    if (grouped.has(stage)) {
      grouped.get(stage)!.push(contact)
    } else {
      grouped.get(defaultStage)?.push(contact)
    }
  }

  const totalContacts = contacts.length

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activePipeline?.name ?? 'Contacts'} · {totalContacts} contact
            {totalContacts !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/pipelines"
            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Manage Pipelines
          </Link>
          <Link
            href="/contacts/new"
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Add Contact
          </Link>
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

      {/* Loading */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          Loading...
        </div>
      ) : (
        /* Kanban board */
        <div className="overflow-x-auto flex-1">
          <div className="flex gap-4 h-full pb-4" style={{ minWidth: `${stages.length * 272}px` }}>
            {stages.map((stage) => {
              const cards = grouped.get(stage.name) ?? []
              return (
                <div key={stage.name} className="w-64 shrink-0 flex flex-col">
                  {/* Column header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="text-xs font-semibold text-gray-700 truncate">
                      {stage.name}
                    </span>
                    <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                      {cards.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex flex-col gap-2 flex-1">
                    {cards.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
                        <p className="text-xs text-gray-300">No contacts</p>
                      </div>
                    ) : (
                      cards.map((contact) => (
                        <div
                          key={contact.id}
                          className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm"
                        >
                          {/* Avatar + name */}
                          <div className="flex items-center gap-2.5 mb-1">
                            <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                              <span className="text-teal-700 text-[10px] font-bold">
                                {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {contact.full_name}
                            </p>
                          </div>

                          {/* Email */}
                          {contact.email && (
                            <p className="text-xs text-gray-400 truncate mb-1.5">{contact.email}</p>
                          )}

                          {/* Lead score + lifecycle badges */}
                          {(contact.lead_score != null || contact.lifecycle_stage) && (
                            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                              {contact.lead_score != null && (
                                <span className="inline-flex items-center gap-0.5">
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    {contact.lead_score}
                                  </span>
                                  {contact.lead_grade && (
                                    <span
                                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${gradeColors[contact.lead_grade] ?? 'bg-gray-100 text-gray-600'}`}
                                    >
                                      {contact.lead_grade}
                                    </span>
                                  )}
                                </span>
                              )}
                              {contact.lifecycle_stage && (
                                <span
                                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${lifecycleColors[contact.lifecycle_stage] ?? 'bg-gray-100 text-gray-600'}`}
                                >
                                  {lifecycleLabel[contact.lifecycle_stage] ??
                                    contact.lifecycle_stage}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Stage badge */}
                          <div className="flex items-center gap-1 mb-1">
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: stage.color }}
                            />
                            <span className="text-[11px] text-gray-500">{stage.name}</span>
                          </div>

                          {/* Stage selector */}
                          <select
                            value={contact.pipeline_stage ?? defaultStage}
                            disabled={movingContact === contact.id}
                            onChange={(e) => void moveContact(contact.id, e.target.value)}
                            className="w-full mt-2 text-xs border border-gray-100 rounded-md px-2 py-1 bg-gray-50 text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50 cursor-pointer"
                          >
                            {stages.map((s) => (
                              <option key={s.name} value={s.name}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
