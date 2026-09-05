'use client'

import { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Chip from '@mui/material/Chip'

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
      .then((d: { id: string; full_name: string }[]) => {
        if (Array.isArray(d)) setTenantUsers(d)
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
            <RadioGroup
              value={filters.sort_by}
              onChange={(e) =>
                update({
                  sort_by: e.target.value,
                  sort_dir: e.target.value === 'lead_score' ? 'desc' : filters.sort_dir,
                })
              }
            >
              {[
                { value: 'created_at', label: 'Date Added' },
                { value: 'full_name', label: 'Name' },
                { value: 'last_contacted_at', label: 'Last Contacted' },
                { value: 'lead_score', label: 'Lead Score' },
              ].map((opt) => (
                <FormControlLabel
                  key={opt.value}
                  value={opt.value}
                  control={<Radio size="small" />}
                  label={<span className="text-xs text-ink3">{opt.label}</span>}
                />
              ))}
            </RadioGroup>
            <ToggleButtonGroup
              value={filters.sort_dir}
              exclusive
              onChange={(_, dir: string | null) => dir && update({ sort_dir: dir })}
              fullWidth
              size="small"
              sx={{ mt: 1 }}
            >
              <ToggleButton value="asc" sx={{ fontSize: 10 }}>
                Ascending
              </ToggleButton>
              <ToggleButton value="desc" sx={{ fontSize: 10 }}>
                Descending
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        )

      case 'last_contacted':
        return (
          <RadioGroup
            value={`${filters.last_contacted_from}|${filters.last_contacted_to}`}
            onChange={(e) => {
              const p = LAST_CONTACTED_PRESETS.find((p) => `${p.from}|${p.to}` === e.target.value)
              if (p) update({ last_contacted_from: p.from, last_contacted_to: p.to })
            }}
          >
            {LAST_CONTACTED_PRESETS.map((p) => (
              <FormControlLabel
                key={p.label}
                value={`${p.from}|${p.to}`}
                control={<Radio size="small" />}
                label={<span className="text-xs text-ink3">{p.label}</span>}
              />
            ))}
          </RadioGroup>
        )

      case 'created':
        return (
          <RadioGroup
            value={`${filters.created_from}|${filters.created_to}`}
            onChange={(e) => {
              const p = CREATED_PRESETS.find((p) => `${p.from}|${p.to}` === e.target.value)
              if (p) update({ created_from: p.from, created_to: p.to })
            }}
          >
            {CREATED_PRESETS.map((p) => (
              <FormControlLabel
                key={p.label}
                value={`${p.from}|${p.to}`}
                control={<Radio size="small" />}
                label={<span className="text-xs text-ink3">{p.label}</span>}
              />
            ))}
          </RadioGroup>
        )

      case 'pipeline_stage':
        return (
          <div>
            {stages.map((stage) => (
              <FormControlLabel
                key={stage.id}
                control={
                  <Checkbox
                    size="small"
                    checked={filters.pipeline_stage_id.includes(stage.id)}
                    onChange={() => toggleArrayItem('pipeline_stage_id', stage.id)}
                  />
                }
                label={
                  <span className="flex items-center gap-1.5 text-xs text-ink3">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    {stage.name}
                  </span>
                }
                sx={{ display: 'flex' }}
              />
            ))}
          </div>
        )

      case 'source':
        return (
          <div>
            {SOURCE_OPTIONS.map((s) => (
              <FormControlLabel
                key={s.value}
                control={
                  <Checkbox
                    size="small"
                    checked={filters.source.includes(s.value)}
                    onChange={() => toggleArrayItem('source', s.value)}
                  />
                }
                label={<span className="text-xs text-ink3">{s.label}</span>}
                sx={{ display: 'flex' }}
              />
            ))}
          </div>
        )

      case 'lifecycle_stage':
        return (
          <div>
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
              <FormControlLabel
                key={opt.value}
                control={
                  <Checkbox
                    size="small"
                    checked={filters.lifecycle_stage.includes(opt.value)}
                    onChange={() => toggleArrayItem('lifecycle_stage', opt.value)}
                  />
                }
                label={<span className="text-xs text-ink3">{opt.label}</span>}
                sx={{ display: 'flex' }}
              />
            ))}
          </div>
        )

      case 'tags':
        return (
          <>
            {filters.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {filters.tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    onDelete={() => toggleArrayItem('tags', tag)}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 500,
                      bgcolor: '#f0fdfa',
                      color: '#0f766e',
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                ))}
              </div>
            )}
            <TextField
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add tag..."
              size="small"
              fullWidth
            />
            {tagInput && tagSuggestions.length > 0 && (
              <div className="mt-1 border border-border-brand rounded bg-white max-h-24 overflow-y-auto">
                {tagSuggestions.slice(0, 5).map((t) => (
                  <ButtonBase
                    key={t}
                    onClick={() => {
                      toggleArrayItem('tags', t)
                      setTagInput('')
                    }}
                    sx={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      fontSize: 12,
                      px: 1,
                      py: 0.5,
                      color: 'text.secondary',
                      '&:hover': { bgcolor: '#f9f8f5' },
                    }}
                  >
                    {t}
                  </ButtonBase>
                ))}
              </div>
            )}
          </>
        )

      case 'has_open_quote':
        return (
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={filters.has_open_quote}
                onChange={(e) => update({ has_open_quote: e.target.checked })}
              />
            }
            label={<span className="text-xs text-ink3">Has open quote</span>}
          />
        )

      case 'assigned_to':
        return (
          <Select
            value={filters.assigned_to}
            onChange={(e) => update({ assigned_to: e.target.value })}
            displayEmpty
            size="small"
            fullWidth
          >
            <MenuItem value="">Any</MenuItem>
            <MenuItem value="unassigned">Unassigned</MenuItem>
            {tenantUsers.map((user) => (
              <MenuItem key={user.id} value={user.id}>
                {user.full_name}
              </MenuItem>
            ))}
          </Select>
        )

      case 'lead_grade':
        return (
          <div>
            {['A', 'B', 'C', 'D', 'F'].map((g) => (
              <FormControlLabel
                key={g}
                control={
                  <Checkbox
                    size="small"
                    checked={filters.grade.includes(g)}
                    onChange={() => toggleArrayItem('grade', g)}
                  />
                }
                label={<span className="text-xs text-ink3">{g}</span>}
                sx={{ display: 'flex' }}
              />
            ))}
          </div>
        )

      case 'territory':
        return (
          <TextField
            value={filters.territory}
            onChange={(e) => update({ territory: e.target.value })}
            placeholder="e.g. North, South..."
            size="small"
            fullWidth
          />
        )

      case 'referral_source':
        return (
          <div className="relative">
            <TextField
              value={referralInput}
              onChange={(e) => {
                setReferralInput(e.target.value)
                update({ referral_source: e.target.value })
              }}
              placeholder="e.g. Google, Instagram..."
              size="small"
              fullWidth
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
                      <ButtonBase
                        key={s}
                        onClick={() => {
                          setReferralInput(s)
                          update({ referral_source: s })
                        }}
                        sx={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          fontSize: 12,
                          px: 1,
                          py: 0.5,
                          color: 'text.secondary',
                          '&:hover': { bgcolor: '#f9f8f5' },
                        }}
                      >
                        {s}
                      </ButtonBase>
                    ))}
                </div>
              )}
          </div>
        )

      case 'has_referral_source':
        return (
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={filters.has_referral_source}
                onChange={(e) => update({ has_referral_source: e.target.checked })}
              />
            }
            label={<span className="text-xs text-ink3">Has referral source</span>}
          />
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
            <Button
              onClick={resetToDefault}
              size="small"
              sx={{ fontSize: 10, minWidth: 0, textTransform: 'none' }}
            >
              Reset
            </Button>
          )}
          <IconButton
            onClick={() => setCustomizeMode((v) => !v)}
            title="Customize filter layout"
            size="small"
            sx={{ color: customizeMode ? 'primary.main' : 'text.secondary' }}
          >
            {/* gear icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
          </IconButton>
          {activeCount > 0 && !customizeMode && (
            <Button
              onClick={() => onChange(EMPTY_FILTERS)}
              size="small"
              color="error"
              sx={{ fontSize: 10, minWidth: 0, textTransform: 'none' }}
            >
              Clear all
            </Button>
          )}
          <IconButton onClick={onClose} size="small" aria-label="Close filters">
            <span className="text-ink4 text-sm leading-none">×</span>
          </IconButton>
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
                          <ButtonBase
                            onClick={() => toggleCollapsed(id)}
                            sx={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              textAlign: 'left',
                              minWidth: 0,
                            }}
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
                          </ButtonBase>
                          {customizeMode && (
                            <IconButton
                              onClick={() => toggleHidden(id)}
                              title={isHiddenSection ? 'Show section' : 'Hide section'}
                              size="small"
                              sx={{
                                ml: 0.5,
                                p: 0.25,
                                color: isHiddenSection ? 'text.disabled' : '#14b8a6',
                              }}
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
                            </IconButton>
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
