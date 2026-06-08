'use client'

import { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'

export interface FilterState {
  q: string
  pipeline_stage_id: string[]
  source: string[]
  tags: string[]
  last_contacted_from: string
  last_contacted_to: string
  created_from: string
  created_to: string
  has_open_quote: boolean
  referral_source: string
  has_referral_source: boolean
  lifecycle_stage: string[]
  grade: string[]
  assigned_to: string
  territory: string
  sort_by: string
  sort_dir: string
}

export const EMPTY_FILTERS: FilterState = {
  q: '',
  pipeline_stage_id: [],
  source: [],
  tags: [],
  last_contacted_from: '',
  last_contacted_to: '',
  created_from: '',
  created_to: '',
  has_open_quote: false,
  referral_source: '',
  has_referral_source: false,
  lifecycle_stage: [],
  grade: [],
  assigned_to: '',
  territory: '',
  sort_by: 'created_at',
  sort_dir: 'desc',
}

interface Stage {
  id: string
  name: string
  color: string
}

const SOURCE_OPTIONS = [
  { value: 'inbound_call', label: 'Call' },
  { value: 'web_form', label: 'Form' },
  { value: 'manual', label: 'Manual' },
  { value: 'import', label: 'Import' },
  { value: 'referral', label: 'Referral' },
  { value: 'outbound_call', label: 'Outbound' },
]

const LAST_CONTACTED_PRESETS = [
  { label: 'Any', from: '', to: '' },
  { label: 'Last 7 days', from: daysAgoStr(7), to: '' },
  { label: 'Last 30 days', from: daysAgoStr(30), to: '' },
  { label: 'Last 90 days', from: daysAgoStr(90), to: '' },
  { label: 'Over 90 days', from: '', to: daysAgoStr(90) },
]

const CREATED_PRESETS = [
  { label: 'Any', from: '', to: '' },
  { label: 'This week', from: daysAgoStr(7), to: '' },
  { label: 'This month', from: daysAgoStr(30), to: '' },
  { label: 'Last 30 days', from: daysAgoStr(30), to: '' },
]

function daysAgoStr(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0]!
}

// ── Section config ─────────────────────────────────────────────────────────────

const SECTION_IDS = [
  'sort_by',
  'last_contacted',
  'created',
  'pipeline_stage',
  'source',
  'lifecycle_stage',
  'tags',
  'has_open_quote',
  'assigned_to',
  'lead_grade',
  'territory',
  'referral_source',
  'has_referral_source',
] as const
type SectionId = (typeof SECTION_IDS)[number]

const SECTION_LABELS: Record<SectionId, string> = {
  sort_by: 'Sort By',
  last_contacted: 'Last Contacted',
  created: 'Created',
  pipeline_stage: 'Pipeline Stage',
  source: 'Source',
  lifecycle_stage: 'Lifecycle Stage',
  tags: 'Tags',
  has_open_quote: 'Has Open Quote',
  assigned_to: 'Assigned To',
  lead_grade: 'Lead Grade',
  territory: 'Territory',
  referral_source: 'Referral Source',
  has_referral_source: 'Has Referral Source',
}

const DEFAULT_ORDER: SectionId[] = [...SECTION_IDS]

const DEFAULT_COLLAPSED: SectionId[] = [
  'pipeline_stage',
  'lead_grade',
  'territory',
  'assigned_to',
  'referral_source',
  'has_open_quote',
  'has_referral_source',
]

const DEFAULT_HIDDEN: SectionId[] = []

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_KEY = 'nuatis-contacts-filter-layout'

interface LayoutState {
  order: SectionId[]
  hidden: SectionId[]
  collapsed: SectionId[]
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown; collapsed?: unknown }
      const validSet = new Set<string>(SECTION_IDS)

      const rawOrder = Array.isArray(parsed.order) ? (parsed.order as string[]) : []
      const filteredOrder = rawOrder.filter((id): id is SectionId => validSet.has(id))
      const savedSet = new Set(filteredOrder)
      const missing = SECTION_IDS.filter((id) => !savedSet.has(id))
      const order = [...filteredOrder, ...missing]

      const hidden = Array.isArray(parsed.hidden)
        ? (parsed.hidden as string[]).filter((id): id is SectionId => validSet.has(id))
        : [...DEFAULT_HIDDEN]

      const collapsed = Array.isArray(parsed.collapsed)
        ? (parsed.collapsed as string[]).filter((id): id is SectionId => validSet.has(id))
        : [...DEFAULT_COLLAPSED]

      return { order, hidden, collapsed }
    }
  } catch {
    // ignore storage errors
  }
  return {
    order: [...DEFAULT_ORDER],
    hidden: [...DEFAULT_HIDDEN],
    collapsed: [...DEFAULT_COLLAPSED],
  }
}

function saveLayout(layout: LayoutState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layout))
  } catch {
    // ignore storage errors
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  filters: FilterState
  onChange: (filters: FilterState) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContactFilters({ filters, onChange, onClose }: Props) {
  const [stages, setStages] = useState<Stage[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [referralSources, setReferralSources] = useState<string[]>([])
  const [referralInput, setReferralInput] = useState(filters.referral_source)
  const [tenantUsers, setTenantUsers] = useState<{ id: string; full_name: string }[]>([])

  // Layout state — canonical defaults used for SSR; hydrated from localStorage after mount
  const [order, setOrder] = useState<SectionId[]>([...DEFAULT_ORDER])
  const [hidden, setHidden] = useState<SectionId[]>([...DEFAULT_HIDDEN])
  const [collapsed, setCollapsed] = useState<SectionId[]>([...DEFAULT_COLLAPSED])
  const [customizeMode, setCustomizeMode] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const layout = loadLayout()
    setOrder(layout.order)
    setHidden(layout.hidden)
    setCollapsed(layout.collapsed)
  }, [])

  useEffect(() => {
    void fetch('/api/users')
      .then((r) => r.json())
      .then((d: { users: { id: string; full_name: string }[] }) => {
        if (d.users) setTenantUsers(d.users)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    void fetch('/api/contacts/stages')
      .then((r) => r.json())
      .then((d: { stages: Stage[] }) => setStages(d.stages))
      .catch(() => {})

    void fetch('/api/contacts/tags')
      .then((r) => r.json())
      .then((d: { tags: string[] }) => setAllTags(d.tags))
      .catch(() => {})

    void fetch('/api/contacts/referral-sources')
      .then((r) => r.json())
      .then((d: { sources: string[] }) => setReferralSources(d.sources))
      .catch(() => {})
  }, [])

  const update = (patch: Partial<FilterState>) => {
    onChange({ ...filters, ...patch })
  }

  const toggleArrayItem = (
    field: 'pipeline_stage_id' | 'source' | 'tags' | 'lifecycle_stage' | 'grade',
    value: string
  ) => {
    const arr = filters[field]
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
    update({ [field]: next })
  }

  const toggleCollapsed = (id: SectionId) => {
    const next = collapsed.includes(id) ? collapsed.filter((s) => s !== id) : [...collapsed, id]
    setCollapsed(next)
    if (mounted) saveLayout({ order, hidden, collapsed: next })
  }

  const toggleHidden = (id: SectionId) => {
    const next = hidden.includes(id) ? hidden.filter((s) => s !== id) : [...hidden, id]
    setHidden(next)
    if (mounted) saveLayout({ order, hidden: next, collapsed })
  }

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return
    if (result.source.index === result.destination.index) return
    const next = [...order]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved!)
    setOrder(next)
    if (mounted) saveLayout({ order: next, hidden, collapsed })
  }

  const resetToDefault = () => {
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      // ignore storage errors
    }
    setOrder([...DEFAULT_ORDER])
    setHidden([...DEFAULT_HIDDEN])
    setCollapsed([...DEFAULT_COLLAPSED])
  }

  const activeCount =
    (filters.q ? 1 : 0) +
    (filters.pipeline_stage_id.length > 0 ? 1 : 0) +
    (filters.source.length > 0 ? 1 : 0) +
    (filters.tags.length > 0 ? 1 : 0) +
    (filters.last_contacted_from || filters.last_contacted_to ? 1 : 0) +
    (filters.created_from || filters.created_to ? 1 : 0) +
    (filters.has_open_quote ? 1 : 0) +
    (filters.referral_source ? 1 : 0) +
    (filters.has_referral_source ? 1 : 0) +
    (filters.lifecycle_stage.length > 0 ? 1 : 0) +
    (filters.grade.length > 0 ? 1 : 0) +
    (filters.assigned_to ? 1 : 0) +
    (filters.territory ? 1 : 0)

  const tagSuggestions = allTags.filter(
    (t) => !filters.tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())
  )

  const renderSectionContent = (id: SectionId) => {
    switch (id) {
      case 'sort_by':
        return (
          <>
            <div className="space-y-1">
              {[
                { value: 'created_at', label: 'Date Added' },
                { value: 'full_name', label: 'Name' },
                { value: 'last_contacted_at', label: 'Last Contacted' },
                { value: 'lead_score', label: 'Lead Score' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="sort_by"
                    checked={filters.sort_by === opt.value}
                    onChange={() =>
                      update({
                        sort_by: opt.value,
                        sort_dir: opt.value === 'lead_score' ? 'desc' : filters.sort_dir,
                      })
                    }
                    className="border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              {['asc', 'desc'].map((dir) => (
                <button
                  key={dir}
                  onClick={() => update({ sort_dir: dir })}
                  className={`flex-1 text-[10px] py-1 rounded border transition-colors ${
                    filters.sort_dir === dir
                      ? 'border-teal-500 bg-teal-50 text-teal-700 font-medium'
                      : 'border-border-brand text-ink3 hover:bg-bg'
                  }`}
                >
                  {dir === 'asc' ? 'Ascending' : 'Descending'}
                </button>
              ))}
            </div>
          </>
        )

      case 'last_contacted':
        return (
          <div className="space-y-1">
            {LAST_CONTACTED_PRESETS.map((p) => (
              <label
                key={p.label}
                className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
              >
                <input
                  type="radio"
                  name="last_contacted"
                  checked={
                    filters.last_contacted_from === p.from && filters.last_contacted_to === p.to
                  }
                  onChange={() => update({ last_contacted_from: p.from, last_contacted_to: p.to })}
                  className="border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                {p.label}
              </label>
            ))}
          </div>
        )

      case 'created':
        return (
          <div className="space-y-1">
            {CREATED_PRESETS.map((p) => (
              <label
                key={p.label}
                className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
              >
                <input
                  type="radio"
                  name="created"
                  checked={filters.created_from === p.from && filters.created_to === p.to}
                  onChange={() => update({ created_from: p.from, created_to: p.to })}
                  className="border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                {p.label}
              </label>
            ))}
          </div>
        )

      case 'pipeline_stage':
        return (
          <div className="space-y-1">
            {stages.map((stage) => (
              <label
                key={stage.id}
                className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.pipeline_stage_id.includes(stage.id)}
                  onChange={() => toggleArrayItem('pipeline_stage_id', stage.id)}
                  className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: stage.color }}
                />
                {stage.name}
              </label>
            ))}
          </div>
        )

      case 'source':
        return (
          <div className="space-y-1">
            {SOURCE_OPTIONS.map((s) => (
              <label
                key={s.value}
                className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.source.includes(s.value)}
                  onChange={() => toggleArrayItem('source', s.value)}
                  className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                {s.label}
              </label>
            ))}
          </div>
        )

      case 'lifecycle_stage':
        return (
          <div className="space-y-1">
            {[
              { value: 'subscriber', label: 'Subscriber' },
              { value: 'lead', label: 'Lead' },
              { value: 'marketing_qualified', label: 'Marketing Qualified' },
              { value: 'sales_qualified', label: 'Sales Qualified' },
              { value: 'opportunity', label: 'Opportunity' },
              { value: 'customer', label: 'Customer' },
              { value: 'evangelist', label: 'Evangelist' },
              { value: 'other', label: 'Other' },
            ].map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-xs text-ink3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.lifecycle_stage.includes(opt.value)}
                  onChange={() => toggleArrayItem('lifecycle_stage', opt.value)}
                  className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                {opt.label}
              </label>
            ))}
          </div>
        )

      case 'tags':
        return (
          <>
            {filters.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {filters.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700"
                  >
                    {tag}
                    <button
                      onClick={() => toggleArrayItem('tags', tag)}
                      className="text-teal-400 hover:text-teal-600"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add tag..."
              className="w-full text-xs border border-border-brand rounded px-2 py-1.5 placeholder-gray-300"
            />
            {tagInput && tagSuggestions.length > 0 && (
              <div className="mt-1 border border-border-brand rounded bg-white max-h-24 overflow-y-auto">
                {tagSuggestions.slice(0, 5).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      toggleArrayItem('tags', t)
                      setTagInput('')
                    }}
                    className="block w-full text-left text-xs px-2 py-1 hover:bg-bg text-ink3"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </>
        )

      case 'has_open_quote':
        return (
          <label className="flex items-center gap-2 text-xs text-ink3 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.has_open_quote}
              onChange={(e) => update({ has_open_quote: e.target.checked })}
              className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            />
            Has open quote
          </label>
        )

      case 'assigned_to':
        return (
          <select
            value={filters.assigned_to}
            onChange={(e) => update({ assigned_to: e.target.value })}
            className="w-full text-xs border border-border-brand rounded px-2 py-1.5 text-ink3 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">Any</option>
            <option value="unassigned">Unassigned</option>
            {tenantUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        )

      case 'lead_grade':
        return (
          <div className="space-y-1">
            {['A', 'B', 'C', 'D', 'F'].map((g) => (
              <label key={g} className="flex items-center gap-2 text-xs text-ink3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.grade.includes(g)}
                  onChange={() => toggleArrayItem('grade', g)}
                  className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                />
                {g}
              </label>
            ))}
          </div>
        )

      case 'territory':
        return (
          <input
            type="text"
            value={filters.territory}
            onChange={(e) => update({ territory: e.target.value })}
            placeholder="e.g. North, South..."
            className="w-full text-xs border border-border-brand rounded px-2 py-1.5 placeholder-gray-300"
          />
        )

      case 'referral_source':
        return (
          <div className="relative">
            <input
              type="text"
              value={referralInput}
              onChange={(e) => {
                setReferralInput(e.target.value)
                update({ referral_source: e.target.value })
              }}
              placeholder="e.g. Google, Instagram..."
              className="w-full text-xs border border-border-brand rounded px-2 py-1.5 placeholder-gray-300"
            />
            {referralInput &&
              referralSources.filter(
                (s) => s.toLowerCase().includes(referralInput.toLowerCase()) && s !== referralInput
              ).length > 0 && (
                <div className="absolute top-full left-0 w-full mt-1 bg-white border border-border-brand rounded shadow-lg z-10 max-h-24 overflow-y-auto">
                  {referralSources
                    .filter(
                      (s) =>
                        s.toLowerCase().includes(referralInput.toLowerCase()) && s !== referralInput
                    )
                    .slice(0, 5)
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setReferralInput(s)
                          update({ referral_source: s })
                        }}
                        className="block w-full text-left text-xs px-2 py-1 hover:bg-bg text-ink3"
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
          </div>
        )

      case 'has_referral_source':
        return (
          <label className="flex items-center gap-2 text-xs text-ink3 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.has_referral_source}
              onChange={(e) => update({ has_referral_source: e.target.checked })}
              className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            />
            Has referral source
          </label>
        )

      default:
        return null
    }
  }

  // In customize mode show all sections; outside show only non-hidden ones
  const visibleOrder = customizeMode ? order : order.filter((id) => !hidden.includes(id))

  return (
    <div className="w-72 bg-white border-l border-border-brand p-4 overflow-y-auto shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ink2">
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </h3>
        <div className="flex items-center gap-2">
          {customizeMode && (
            <button
              onClick={resetToDefault}
              className="text-[10px] text-ink4 hover:text-ink3 underline"
            >
              Reset
            </button>
          )}
          <button
            onClick={() => setCustomizeMode((v) => !v)}
            title="Customize filter layout"
            className={`transition-colors ${customizeMode ? 'text-teal-600' : 'text-ink4 hover:text-ink3'}`}
          >
            {/* gear icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {activeCount > 0 && !customizeMode && (
            <button
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-[10px] text-red-500 hover:text-red-600"
            >
              Clear all
            </button>
          )}
          <button onClick={onClose} className="text-ink4 hover:text-ink3 text-sm">
            &times;
          </button>
        </div>
      </div>

      {/* Sections */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable
          droppableId="filter-sections"
          type="filter-section"
          isDropDisabled={!customizeMode}
        >
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {visibleOrder.map((id, idx) => {
                const isCollapsed = collapsed.includes(id)
                const isHiddenSection = hidden.includes(id)

                return (
                  <Draggable key={id} draggableId={id} index={idx} isDragDisabled={!customizeMode}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`mb-4 ${dragSnapshot.isDragging ? 'opacity-75' : ''} ${
                          customizeMode && isHiddenSection ? 'opacity-50' : ''
                        }`}
                        style={dragProvided.draggableProps.style ?? undefined}
                      >
                        {/* Section header row */}
                        <div className="flex items-center gap-1 mb-1.5">
                          {customizeMode && dragProvided.dragHandleProps && (
                            <span
                              {...dragProvided.dragHandleProps}
                              className="text-ink4 cursor-grab active:cursor-grabbing select-none text-sm leading-none shrink-0"
                              aria-label="Drag to reorder"
                            >
                              ⠿
                            </span>
                          )}
                          <button
                            onClick={() => toggleCollapsed(id)}
                            className="flex-1 flex items-center gap-1 text-left min-w-0"
                          >
                            <span className="text-[10px] font-medium text-ink4 uppercase">
                              {SECTION_LABELS[id]}
                            </span>
                            <svg
                              className={`w-3 h-3 text-ink4 ml-auto shrink-0 transition-transform ${
                                isCollapsed ? '' : 'rotate-180'
                              }`}
                              viewBox="0 0 10 6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            >
                              <path d="M1 1l4 4 4-4" />
                            </svg>
                          </button>
                          {customizeMode && (
                            <button
                              onClick={() => toggleHidden(id)}
                              title={isHiddenSection ? 'Show section' : 'Hide section'}
                              className={`ml-1 shrink-0 transition-colors ${
                                isHiddenSection ? 'text-ink4' : 'text-teal-500'
                              }`}
                            >
                              {isHiddenSection ? (
                                // eye-off
                                <svg
                                  className="w-3.5 h-3.5"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.091a4 4 0 00-5.557-5.556z"
                                    clipRule="evenodd"
                                  />
                                  <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                                </svg>
                              ) : (
                                // eye
                                <svg
                                  className="w-3.5 h-3.5"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                                  <path
                                    fillRule="evenodd"
                                    d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>

                        {/* Section content — hidden when collapsed; dimmed when hidden in customize mode */}
                        {!isCollapsed && (
                          <div
                            className={
                              customizeMode && isHiddenSection ? 'pointer-events-none' : undefined
                            }
                          >
                            {renderSectionContent(id)}
                          </div>
                        )}
                      </div>
                    )}
                  </Draggable>
                )
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  )
}
