'use client'

import { useState, useEffect, useCallback } from 'react'
import type { FilterState } from './ContactFilters'

interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
  sort_by: string | null
  sort_dir: string | null
  is_default: boolean
  user_id: string | null
  sort_order: number
}

interface Props {
  activeViewId: string | null
  onSelectView: (view: SavedView) => void
  currentFilters: FilterState
  hasActiveFilters: boolean
}

export default function SavedViews({
  activeViewId,
  onSelectView,
  currentFilters,
  hasActiveFilters,
}: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  const fetchViews = useCallback(async () => {
    const res = await fetch('/api/views')
    if (res.ok) {
      const data = (await res.json()) as { views: SavedView[] }
      setViews(data.views)
    }
  }, [])

  useEffect(() => {
    void fetchViews()
  }, [fetchViews])

  const saveView = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          filters: {
            ...(currentFilters.q ? { q: currentFilters.q } : {}),
            ...(currentFilters.pipeline_stage_id.length > 0
              ? { pipeline_stage_id: currentFilters.pipeline_stage_id.join(',') }
              : {}),
            ...(currentFilters.source.length > 0
              ? { source: currentFilters.source.join(',') }
              : {}),
            ...(currentFilters.tags.length > 0 ? { tags: currentFilters.tags.join(',') } : {}),
            ...(currentFilters.last_contacted_from
              ? { last_contacted_from: currentFilters.last_contacted_from }
              : {}),
            ...(currentFilters.last_contacted_to
              ? { last_contacted_to: currentFilters.last_contacted_to }
              : {}),
            ...(currentFilters.created_from ? { created_from: currentFilters.created_from } : {}),
            ...(currentFilters.created_to ? { created_to: currentFilters.created_to } : {}),
            ...(currentFilters.has_open_quote ? { has_open_quote: 'true' } : {}),
          },
          sort_by: currentFilters.sort_by,
          sort_dir: currentFilters.sort_dir,
        }),
      })
      if (res.ok) {
        setNewName('')
        setShowSaveInput(false)
        void fetchViews()
      }
    } finally {
      setSaving(false)
    }
  }

  const deleteView = async (viewId: string) => {
    await fetch(`/api/views/${viewId}`, { method: 'DELETE' })
    void fetchViews()
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {views.map((view) => (
          <button
            key={view.id}
            onClick={() => onSelectView(view)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors group ${
              activeViewId === view.id
                ? 'bg-teal-100 text-teal-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {view.name}
            {!view.user_id && <span className="text-[8px] opacity-50">shared</span>}
            {view.user_id && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteView(view.id)
                }}
                className="hidden group-hover:inline text-gray-400 hover:text-red-500 ml-0.5 cursor-pointer"
              >
                &times;
              </span>
            )}
          </button>
        ))}

        {/* Save current view button */}
        {hasActiveFilters && !activeViewId && !showSaveInput && (
          <button
            onClick={() => setShowSaveInput(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 transition-colors"
          >
            + Save view
          </button>
        )}

        {showSaveInput && (
          <div className="inline-flex items-center gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="View name..."
              autoFocus
              className="text-xs border border-gray-200 rounded-full px-3 py-1.5 w-32"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveView()
                if (e.key === 'Escape') setShowSaveInput(false)
              }}
            />
            <button
              onClick={() => void saveView()}
              disabled={!newName.trim() || saving}
              className="text-xs font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveInput(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
