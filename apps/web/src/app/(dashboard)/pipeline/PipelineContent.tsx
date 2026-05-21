'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'

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
  value?: number
}

interface PopoverState {
  type: 'sms' | 'note'
  contactId: string
  contactName: string
  contactPhone: string | null
  top?: number
  bottom?: number
  left: number
}

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function formatColumnValue(amount: number): string {
  return currencyFmt.format(amount)
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

// Inline SVG icons
function PhoneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.33h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function MessageSquareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function FileTextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
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
  const [isDefaultFallback, setIsDefaultFallback] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null)
  const [activePopover, setActivePopover] = useState<PopoverState | null>(null)
  const [popoverText, setPopoverText] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('nuatis_pipeline_collapsed')
      return new Set(saved ? (JSON.parse(saved) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  const [colorMode, setColorMode] = useState<'none' | 'dot' | 'tint'>(() => {
    try {
      const saved = localStorage.getItem('nuatis_pipeline_color_mode')
      if (saved === 'dot' || saved === 'tint') return saved
    } catch {
      // localStorage unavailable
    }
    return 'none'
  })

  const setColorModeAndSave = (mode: 'none' | 'dot' | 'tint') => {
    setColorMode(mode)
    try {
      localStorage.setItem('nuatis_pipeline_color_mode', mode)
    } catch {
      // localStorage unavailable
    }
  }

  const toggleCollapse = (stageId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      localStorage.setItem('nuatis_pipeline_collapsed', JSON.stringify([...next]))
      return next
    })
  }

  const showToast = useCallback((msg: string, type: 'error' | 'success' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const closePopover = useCallback(() => {
    setActivePopover(null)
    setPopoverText('')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePopover])

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

          // Filter: vertical-specific match wins; fall back to is_default only if no match
          const verticalLabel = toTitle(vertical)
          const verticalMatches = data.filter((p) =>
            p.name.toLowerCase().includes(verticalLabel.toLowerCase())
          )
          const filtered =
            verticalMatches.length > 0 ? verticalMatches : data.filter((p) => p.is_default)
          const finalFiltered = filtered.length > 0 ? filtered : data
          const usingDefault = verticalMatches.length === 0 && filtered.length > 0

          setIsDefaultFallback(usingDefault)
          setPipelines(finalFiltered)

          // Auto-select: prefer vertical-specific pipeline, fall back to default
          const paramId = searchParams.get('pipeline')
          if (paramId && finalFiltered.find((p) => p.id === paramId)) {
            setActivePipelineId(paramId)
          } else {
            const verticalPipeline = finalFiltered.find((p) => !p.is_default)
            const def =
              verticalPipeline ?? finalFiltered.find((p) => p.is_default) ?? finalFiltered[0]
            if (def) setActivePipelineId(def.id)
          }

          if (finalFiltered.length === 0) setLoading(false)
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

  // ── Micro-action handlers ──────────────────────────────────────────────────

  const handleCall = async (e: React.MouseEvent, contact: Contact) => {
    e.stopPropagation()
    if (!contact.phone) return
    try {
      await fetch('/api/calls/initiate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactPhone: contact.phone }),
      })
      showToast(`Connecting call to ${contact.full_name}…`)
    } catch {
      showToast('Failed to initiate call', 'error')
    }
  }

  const handleOpenPopover = (
    e: React.MouseEvent<HTMLButtonElement>,
    type: 'sms' | 'note',
    contact: Contact
  ) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const above = rect.bottom > window.innerHeight * 0.7
    setPopoverText('')
    setActivePopover({
      type,
      contactId: contact.id,
      contactName: contact.full_name,
      contactPhone: contact.phone,
      top: above ? undefined : rect.bottom + 4,
      bottom: above ? window.innerHeight - rect.top + 4 : undefined,
      left: Math.min(rect.left, window.innerWidth - 272),
    })
  }

  const handleSendSMS = async () => {
    if (!activePopover || !popoverText.trim()) return
    try {
      await fetch('/api/sms/send', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activePopover.contactPhone,
          message: popoverText,
          contactId: activePopover.contactId,
        }),
      })
      showToast(`SMS sent to ${activePopover.contactName}`)
      closePopover()
    } catch {
      showToast('Failed to send SMS', 'error')
    }
  }

  const handleSaveNote = async () => {
    if (!activePopover || !popoverText.trim()) return
    try {
      await fetch(`/api/contacts/${activePopover.contactId}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: popoverText, type: 'note' }),
      })
      showToast('Note saved')
      closePopover()
    } catch {
      showToast('Failed to save note', 'error')
    }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId) return

      const destStage = stages.find((s) => s.id === destination.droppableId)
      if (!destStage) return

      // Optimistic update
      const prevContacts = contacts
      setContacts((prev) =>
        prev.map((c) => (c.id === draggableId ? { ...c, pipeline_stage: destStage.name } : c))
      )

      try {
        const res = await fetch(`/api/contacts/${draggableId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pipeline_stage_id: destination.droppableId }),
        })
        if (!res.ok) throw new Error('Failed to move contact')
      } catch {
        setContacts(prevContacts)
        showToast('Failed to move contact', 'error')
      }
    },
    [stages, contacts, showToast]
  )

  // ── Stage select fallback (existing card dropdown) ─────────────────────────

  const moveContact = async (contactId: string, stageName: string) => {
    setMovingContact(contactId)
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
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-teal-700'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Inline popover (SMS / Note) */}
      {activePopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={closePopover} />
          <div
            className="fixed z-50 w-64 shadow-lg bg-white border border-border-brand rounded-lg p-3"
            style={{
              top: activePopover.top,
              bottom: activePopover.bottom,
              left: activePopover.left,
            }}
          >
            <textarea
              autoFocus
              rows={2}
              value={popoverText}
              onChange={(e) =>
                setPopoverText(
                  activePopover.type === 'sms' ? e.target.value.slice(0, 160) : e.target.value
                )
              }
              placeholder={activePopover.type === 'sms' ? 'Send a message…' : 'Log a note…'}
              className="w-full text-sm border border-border-brand rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            {activePopover.type === 'sms' && (
              <p className="text-[10px] text-ink4 text-right mt-0.5">{popoverText.length}/160</p>
            )}
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={() =>
                  activePopover.type === 'sms' ? void handleSendSMS() : void handleSaveNote()
                }
                disabled={!popoverText.trim()}
                className="px-3 py-1 bg-teal-600 text-white text-xs font-medium rounded hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {activePopover.type === 'sms' ? 'Send' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}

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
          {/* Color mode toggle */}
          <div className="flex items-center border border-border-brand rounded overflow-hidden">
            <button
              type="button"
              title="Dot mode"
              onClick={() => setColorModeAndSave('dot')}
              className={`px-2 py-1 text-xs transition-colors ${
                colorMode === 'dot'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-ink4 hover:text-ink3 hover:bg-bg'
              }`}
            >
              ⊙
            </button>
            <button
              type="button"
              title="Tint mode"
              onClick={() => setColorModeAndSave('tint')}
              className={`px-2 py-1 text-xs transition-colors border-x border-border-brand ${
                colorMode === 'tint'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-ink4 hover:text-ink3 hover:bg-bg'
              }`}
            >
              ▤
            </button>
            <button
              type="button"
              title="No color"
              onClick={() => setColorModeAndSave('none')}
              className={`px-2 py-1 text-xs transition-colors ${
                colorMode === 'none'
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-ink4 hover:text-ink3 hover:bg-bg'
              }`}
            >
              ✕
            </button>
          </div>
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

      {/* Fallback note — shown when no vertical-specific pipeline exists */}
      {isDefaultFallback && !loading && (
        <p className="text-xs text-ink4 mb-3 shrink-0">
          No pipeline configured for this vertical yet.
        </p>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink4">Loading...</div>
      ) : (
        /* Kanban board */
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div
              className="flex gap-3 h-full pb-4"
              style={{
                minWidth: `${stages.reduce((sum, s) => sum + (collapsed.has(s.id) ? 40 : 240), 0) + Math.max(0, stages.length - 1) * 12}px`,
              }}
            >
              {stages.map((stage) => {
                const cards = grouped.get(stage.name) ?? []
                const colColor = stage.color || '#0d9488'
                const totalValue = cards.reduce((sum, c) => sum + (c.value ?? 0), 0)
                return (
                  <Droppable key={stage.id} droppableId={stage.id}>
                    {(provided, snapshot) => {
                      const isCollapsed = collapsed.has(stage.id)
                      return (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`shrink-0 flex flex-col rounded-lg border border-border-brand overflow-hidden transition-all duration-200 ${
                            isCollapsed ? 'w-10' : 'w-60'
                          }`}
                          style={{
                            borderLeftColor: colColor,
                            borderLeftWidth: '3px',
                            minHeight: '400px',
                            backgroundColor: isCollapsed
                              ? '#f9f8f5'
                              : snapshot.isDraggingOver
                                ? '#f2f0eb'
                                : '#ffffff',
                          }}
                        >
                          {isCollapsed ? (
                            /* ── Collapsed column ── */
                            <div className="flex flex-col items-center pt-2 pb-2 flex-1">
                              {/* Expand button */}
                              <button
                                type="button"
                                title="Expand column"
                                onClick={() => toggleCollapse(stage.id)}
                                className="h-5 w-5 flex items-center justify-center text-ink4 hover:text-ink rounded mb-2 shrink-0"
                              >
                                <ChevronRightIcon />
                              </button>
                              {/* Card count badge */}
                              <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded-full w-5 h-5 flex items-center justify-center mb-3 shrink-0 tabular-nums leading-none">
                                {cards.length}
                              </span>
                              {/* Vertical stage name */}
                              <span
                                className="text-xs font-medium text-ink3 select-none flex-1 truncate"
                                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                              >
                                {stage.name}
                              </span>
                              {/* Placeholder in DOM for DnD drop target */}
                              <div style={{ height: 0, overflow: 'hidden' }}>
                                {provided.placeholder}
                              </div>
                            </div>
                          ) : (
                            /* ── Expanded column ── */
                            <>
                              {/* Column header */}
                              <div
                                className="group/header px-3 py-2.5 border-b border-border-brand bg-[#f9f8f5]"
                                style={
                                  colorMode === 'tint'
                                    ? {
                                        backgroundColor: colColor + '1F',
                                        borderLeft: `3px solid ${colColor}`,
                                      }
                                    : undefined
                                }
                              >
                                <div className="flex items-center gap-2">
                                  {colorMode === 'dot' && (
                                    <span
                                      className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                                      style={{ backgroundColor: colColor }}
                                    />
                                  )}
                                  <span className="text-[13px] font-semibold text-ink truncate flex-1">
                                    {stage.name}
                                  </span>
                                  <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                                    {cards.length}
                                  </span>
                                  {/* Collapse button — visible on header hover */}
                                  <button
                                    type="button"
                                    title="Collapse column"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleCollapse(stage.id)
                                    }}
                                    className="h-5 w-5 flex items-center justify-center text-ink4 hover:text-ink rounded opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0"
                                  >
                                    <ChevronLeftIcon />
                                  </button>
                                </div>
                                <p className="text-[11px] text-ink3 mt-0.5 tabular-nums">
                                  {cards.length} deal{cards.length !== 1 ? 's' : ''}{' '}
                                  <span className="text-ink4">·</span>{' '}
                                  {formatColumnValue(totalValue)}
                                </p>
                              </div>

                              {/* Cards */}
                              <div className="flex flex-col gap-2 p-2 flex-1">
                                {cards.length === 0 && !snapshot.isDraggingOver ? (
                                  <div className="rounded border border-dashed border-border-brand px-3 py-5 text-center mt-1">
                                    <p className="text-[11px] text-ink4">No contacts</p>
                                  </div>
                                ) : (
                                  cards.map((contact, index) => (
                                    <Draggable
                                      key={contact.id}
                                      draggableId={contact.id}
                                      index={index}
                                    >
                                      {(dragProvided, dragSnapshot) => (
                                        <div
                                          ref={dragProvided.innerRef}
                                          {...dragProvided.draggableProps}
                                          className="group bg-white rounded-md border border-border-brand p-3 transition-all duration-100 hover:shadow-sm cursor-default"
                                          style={{
                                            ...dragProvided.draggableProps.style,
                                            opacity: dragSnapshot.isDragging ? 0.7 : 1,
                                            boxShadow: dragSnapshot.isDragging
                                              ? '0 10px 25px -3px rgb(0 0 0 / 0.15)'
                                              : undefined,
                                            touchAction: 'none',
                                          }}
                                        >
                                          {/* Name row + drag handle */}
                                          <div className="flex items-start gap-1 mb-1.5">
                                            {/* Drag handle — visible on hover */}
                                            <span
                                              {...dragProvided.dragHandleProps}
                                              className="text-ink4 text-sm leading-none mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing shrink-0 select-none"
                                              aria-label="Drag to reorder"
                                            >
                                              ⠿
                                            </span>

                                            {/* Name + source badge */}
                                            <div className="flex items-start justify-between gap-1.5 flex-1 min-w-0">
                                              <Link
                                                href={`/contacts/${contact.id}`}
                                                className="text-[14px] font-semibold text-ink leading-snug hover:text-teal-700 truncate"
                                              >
                                                {contact.full_name}
                                              </Link>
                                              {contact.source && (
                                                <span
                                                  className={`font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide ${
                                                    contact.source === 'maya' ||
                                                    contact.source === 'inbound_call'
                                                      ? 'bg-teal-50 text-teal-600'
                                                      : 'bg-[#f2f0eb] text-[#7a7468]'
                                                  }`}
                                                >
                                                  {contact.source === 'inbound_call' ||
                                                  contact.source === 'call'
                                                    ? 'MAYA'
                                                    : contact.source.toUpperCase()}
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          {/* Phone */}
                                          {contact.phone && (
                                            <p className="font-mono text-[11px] text-ink3 mb-1 truncate pl-5">
                                              {contact.phone}
                                            </p>
                                          )}

                                          {/* Last activity */}
                                          {contact.last_contacted && (
                                            <p className="text-[10px] text-ink4 mb-2 pl-5">
                                              {relativeTime(contact.last_contacted)}
                                            </p>
                                          )}

                                          {/* Stage selector */}
                                          <select
                                            value={contact.pipeline_stage ?? defaultStage}
                                            disabled={movingContact === contact.id}
                                            onChange={(e) =>
                                              void moveContact(contact.id, e.target.value)
                                            }
                                            className="w-full text-[11px] border border-border-brand rounded px-2 py-1 bg-[#f9f8f5] text-ink3 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50 cursor-pointer"
                                          >
                                            {stages.map((s) => (
                                              <option key={s.name} value={s.name}>
                                                {s.name}
                                              </option>
                                            ))}
                                          </select>

                                          {/* Micro-action buttons */}
                                          <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {/* Call */}
                                            <button
                                              type="button"
                                              title={contact.phone ? 'Call' : 'No phone number'}
                                              disabled={!contact.phone}
                                              onClick={(e) => void handleCall(e, contact)}
                                              className={`h-6 w-6 rounded flex items-center justify-center bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors ${
                                                !contact.phone
                                                  ? 'opacity-40 cursor-not-allowed'
                                                  : ''
                                              }`}
                                            >
                                              <PhoneIcon />
                                            </button>
                                            {/* SMS */}
                                            <button
                                              type="button"
                                              title={contact.phone ? 'Send SMS' : 'No phone number'}
                                              disabled={!contact.phone}
                                              onClick={(e) => handleOpenPopover(e, 'sms', contact)}
                                              className={`h-6 w-6 rounded flex items-center justify-center bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors ${
                                                !contact.phone
                                                  ? 'opacity-40 cursor-not-allowed'
                                                  : ''
                                              }`}
                                            >
                                              <MessageSquareIcon />
                                            </button>
                                            {/* Note */}
                                            <button
                                              type="button"
                                              title="Log Note"
                                              onClick={(e) => handleOpenPopover(e, 'note', contact)}
                                              className="h-6 w-6 rounded flex items-center justify-center bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                                            >
                                              <FileTextIcon />
                                            </button>
                                            {/* Book Appointment */}
                                            <button
                                              type="button"
                                              title="Book Appointment"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                router.push(
                                                  `/appointments/new?contactId=${contact.id}&name=${encodeURIComponent(contact.full_name)}`
                                                )
                                              }}
                                              className="h-6 w-6 rounded flex items-center justify-center bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors"
                                            >
                                              <CalendarIcon />
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </Draggable>
                                  ))
                                )}
                                {provided.placeholder}
                              </div>
                            </>
                          )}
                        </div>
                      )
                    }}
                  </Droppable>
                )
              })}
            </div>
          </div>
        </DragDropContext>
      )}
    </div>
  )
}
