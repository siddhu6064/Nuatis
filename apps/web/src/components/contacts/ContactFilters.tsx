'use client'

import { useState, useEffect } from 'react'

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

interface Props {
  filters: FilterState
  onChange: (filters: FilterState) => void
  onClose: () => void
}

export default function ContactFilters({ filters, onChange, onClose }: Props) {
  const [stages, setStages] = useState<Stage[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [referralSources, setReferralSources] = useState<string[]>([])
  const [referralInput, setReferralInput] = useState(filters.referral_source)

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
    (filters.grade.length > 0 ? 1 : 0)

  const tagSuggestions = allTags.filter(
    (t) => !filters.tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())
  )

  return (
    <div className="w-72 bg-white border-l border-gray-100 p-4 overflow-y-auto shrink-0">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </h3>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-[10px] text-red-500 hover:text-red-600"
            >
              Clear all
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            &times;
          </button>
        </div>
      </div>

      {/* Pipeline Stage */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Pipeline Stage</p>
        <div className="space-y-1">
          {stages.map((stage) => (
            <label
              key={stage.id}
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.pipeline_stage_id.includes(stage.id)}
                onChange={() => toggleArrayItem('pipeline_stage_id', stage.id)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />
              {stage.name}
            </label>
          ))}
        </div>
      </div>

      {/* Source */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Source</p>
        <div className="space-y-1">
          {SOURCE_OPTIONS.map((s) => (
            <label
              key={s.value}
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.source.includes(s.value)}
                onChange={() => toggleArrayItem('source', s.value)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      {/* Last Contacted */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Last Contacted</p>
        <div className="space-y-1">
          {LAST_CONTACTED_PRESETS.map((p) => (
            <label
              key={p.label}
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
            >
              <input
                type="radio"
                name="last_contacted"
                checked={
                  filters.last_contacted_from === p.from && filters.last_contacted_to === p.to
                }
                onChange={() => update({ last_contacted_from: p.from, last_contacted_to: p.to })}
                className="border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {/* Created Date */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Created</p>
        <div className="space-y-1">
          {CREATED_PRESETS.map((p) => (
            <label
              key={p.label}
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
            >
              <input
                type="radio"
                name="created"
                checked={filters.created_from === p.from && filters.created_to === p.to}
                onChange={() => update({ created_from: p.from, created_to: p.to })}
                className="border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Tags</p>
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
          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 placeholder-gray-300"
        />
        {tagInput && tagSuggestions.length > 0 && (
          <div className="mt-1 border border-gray-200 rounded bg-white max-h-24 overflow-y-auto">
            {tagSuggestions.slice(0, 5).map((t) => (
              <button
                key={t}
                onClick={() => {
                  toggleArrayItem('tags', t)
                  setTagInput('')
                }}
                className="block w-full text-left text-xs px-2 py-1 hover:bg-gray-50 text-gray-600"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Has Open Quote */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.has_open_quote}
            onChange={(e) => update({ has_open_quote: e.target.checked })}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
          />
          Has open quote
        </label>
      </div>

      {/* Referral Source */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Referral Source</p>
        <div className="relative">
          <input
            type="text"
            value={referralInput}
            onChange={(e) => {
              setReferralInput(e.target.value)
              update({ referral_source: e.target.value })
            }}
            placeholder="e.g. Google, Instagram..."
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 placeholder-gray-300"
          />
          {referralInput &&
            referralSources.filter(
              (s) => s.toLowerCase().includes(referralInput.toLowerCase()) && s !== referralInput
            ).length > 0 && (
              <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-24 overflow-y-auto">
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
                      className="block w-full text-left text-xs px-2 py-1 hover:bg-gray-50 text-gray-600"
                    >
                      {s}
                    </button>
                  ))}
              </div>
            )}
        </div>
      </div>

      {/* Has Referral Source */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.has_referral_source}
            onChange={(e) => update({ has_referral_source: e.target.checked })}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
          />
          Has referral source
        </label>
      </div>

      {/* Lifecycle Stage */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Lifecycle Stage</p>
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
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.lifecycle_stage.includes(opt.value)}
                onChange={() => toggleArrayItem('lifecycle_stage', opt.value)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Grade */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Lead Grade</p>
        <div className="space-y-1">
          {['A', 'B', 'C', 'D', 'F'].map((g) => (
            <label key={g} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.grade.includes(g)}
                onChange={() => toggleArrayItem('grade', g)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
              />
              {g}
            </label>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">Sort By</p>
        <div className="space-y-1">
          {[
            { value: 'created_at', label: 'Date Added' },
            { value: 'full_name', label: 'Name' },
            { value: 'last_contacted_at', label: 'Last Contacted' },
            { value: 'lead_score', label: 'Lead Score' },
          ].map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
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
                className="border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
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
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {dir === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
