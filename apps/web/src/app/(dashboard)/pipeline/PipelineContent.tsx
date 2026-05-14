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
  phone: string | null
  email: string | null
  source: string | null
  last_contacted: string | null
  pipeline_stage: string | null
  lifecycle_stage: string | null
  lead_score: number | null
  lead_grade: string | null
}

function toTitle(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function PipelineContent({ vertical = 'sales_crm' }: { vertical?: string }) {
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

  // Fetch pipelines list on mount — filtered to current vertical (passed from server component)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/pipelines?type=contacts`, {
          credentials: 'include',
        })
        if (res.ok) {
          const payload = (await res.json()) as { pipelines?: Pipeline[] } | Pipeline[]
          const data: Pipeline[] = Array.isArray(payload) ? payload : (payload.pipelines ?? [])

          // Filter: keep default + pipelines matching current vertical
          const verticalLabel = toTitle(vertical)
          const filtered = data.filter(
            (p) => p.is_default || p.name.toLowerCase().includes(verticalLabel.toLowerCase())
          )

          setPipelines(filtered)

          // Auto-select: prefer vertical-specific pipeline, fall back to default
          const paramId = searchParams.get('pipeline')
          if (paramId && filtered.find((p) => p.id === paramId)) {
            setActivePipelineId(paramId)
          } else {
            const verticalPipeline = filtered.find((p) => !p.is_default)
            const def = verticalPipeline ?? filtered.find((p) => p.is_default) ?? filtered[0]
            if (def) setActivePipelineId(def.id)
          }

          if (filtered.length === 0) setLoading(false)
        } else {
          setLoading(false)
        }
      } catch {
        // silently fail — board stays empty
        setLoading(false)
      }
    })()
  }, [vertical])

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
          <h1 className="text-xl font-bold text-ink">Pipeline</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {activePipeline?.name ?? 'Contacts'} · {totalContacts} contact
            {totalContacts !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/pipelines"
            className="text-xs text-ink3 hover:text-ink2 underline underline-offset-2"
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

      {/* Pipeline tab bar — only show when multiple pipelines match */}
      {pipelines.length > 1 && (
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

      {/* Loading */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink4">Loading...</div>
      ) : (
        /* Kanban board */
        <div className="overflow-x-auto flex-1">
          <div className="flex gap-3 h-full pb-4" style={{ minWidth: `${stages.length * 256}px` }}>
            {stages.map((stage) => {
              const cards = grouped.get(stage.name) ?? []
              const colColor = stage.color || '#0d9488'
              return (
                <div
                  key={stage.name}
                  className="w-60 shrink-0 flex flex-col bg-white rounded-lg border border-border-brand overflow-hidden"
                  style={{ borderLeftColor: colColor, borderLeftWidth: '3px', minHeight: '400px' }}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-brand bg-[#f9f8f5]">
                    <span className="text-[13px] font-semibold text-ink truncate flex-1">
                      {stage.name}
                    </span>
                    <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                      {cards.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex flex-col gap-2 p-2 flex-1">
                    {cards.length === 0 ? (
                      <div className="rounded border border-dashed border-border-brand px-3 py-5 text-center mt-1">
                        <p className="text-[11px] text-ink4">No contacts</p>
                      </div>
                    ) : (
                      cards.map((contact) => (
                        <div
                          key={contact.id}
                          className="bg-white rounded-md border border-border-brand p-3 transition-all duration-100 hover:shadow-sm hover:-translate-y-px cursor-default"
                        >
                          {/* Name + source badge */}
                          <div className="flex items-start justify-between gap-1.5 mb-1.5">
                            <Link
                              href={`/contacts/${contact.id}`}
                              className="text-[14px] font-semibold text-ink leading-snug hover:text-teal-700 truncate"
                            >
                              {contact.full_name}
                            </Link>
                            {contact.source && (
                              <span
                                className={`font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide ${
                                  contact.source === 'maya' || contact.source === 'call'
                                    ? 'bg-teal-50 text-teal-600'
                                    : 'bg-[#f2f0eb] text-[#7a7468]'
                                }`}
                              >
                                {contact.source === 'call' ? 'MAYA' : contact.source.toUpperCase()}
                              </span>
                            )}
                          </div>

                          {/* Phone */}
                          {contact.phone && (
                            <p className="font-mono text-[11px] text-ink3 mb-1 truncate">
                              {contact.phone}
                            </p>
                          )}

                          {/* Last activity */}
                          {contact.last_contacted && (
                            <p className="text-[10px] text-ink4 mb-2">
                              {relativeTime(contact.last_contacted)}
                            </p>
                          )}

                          {/* Stage selector */}
                          <select
                            value={contact.pipeline_stage ?? defaultStage}
                            disabled={movingContact === contact.id}
                            onChange={(e) => void moveContact(contact.id, e.target.value)}
                            className="w-full text-[11px] border border-border-brand rounded px-2 py-1 bg-[#f9f8f5] text-ink3 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50 cursor-pointer"
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
