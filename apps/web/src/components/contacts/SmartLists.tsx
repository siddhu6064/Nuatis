'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { FilterState } from './ContactFilters'

interface SmartList {
  id: string
  name: string
  filters: Record<string, unknown>
}

interface Props {
  activeListId: string | null
  onSelectList: (list: SmartList) => void
  currentFilters: FilterState
  hasActiveFilters: boolean
}

export default function SmartLists({
  activeListId,
  onSelectList,
  currentFilters,
  hasActiveFilters,
}: Props) {
  const [lists, setLists] = useState<SmartList[]>([])
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchLists = useCallback(async () => {
    const res = await fetch('/api/smart-lists')
    if (res.ok) {
      const data = (await res.json()) as { lists: SmartList[] }
      setLists(data.lists)
    }
  }, [])

  useEffect(() => {
    void fetchLists()
  }, [fetchLists])

  useEffect(() => {
    if (showSaveInput) inputRef.current?.focus()
  }, [showSaveInput])

  const saveList = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const filters: Record<string, unknown> = {}
      if (currentFilters.q) filters['q'] = currentFilters.q
      if (currentFilters.pipeline_stage_id.length > 0)
        filters['pipeline_stage_id'] = currentFilters.pipeline_stage_id
      if (currentFilters.source.length > 0) filters['source'] = currentFilters.source
      if (currentFilters.tags.length > 0) filters['tags'] = currentFilters.tags
      if (currentFilters.last_contacted_from)
        filters['last_contacted_from'] = currentFilters.last_contacted_from
      if (currentFilters.last_contacted_to)
        filters['last_contacted_to'] = currentFilters.last_contacted_to
      if (currentFilters.created_from) filters['created_from'] = currentFilters.created_from
      if (currentFilters.created_to) filters['created_to'] = currentFilters.created_to
      if (currentFilters.has_open_quote) filters['has_open_quote'] = true
      if (currentFilters.referral_source)
        filters['referral_source'] = currentFilters.referral_source
      if (currentFilters.has_referral_source) filters['has_referral_source'] = true
      if (currentFilters.lifecycle_stage.length > 0)
        filters['lifecycle_stage'] = currentFilters.lifecycle_stage
      if (currentFilters.grade.length > 0) filters['grade'] = currentFilters.grade
      if (currentFilters.assigned_to) filters['assigned_to'] = currentFilters.assigned_to
      if (currentFilters.territory) filters['territory'] = currentFilters.territory
      if (currentFilters.sort_by !== 'created_at') filters['sort_by'] = currentFilters.sort_by
      if (currentFilters.sort_dir !== 'desc') filters['sort_dir'] = currentFilters.sort_dir

      const res = await fetch('/api/smart-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), filters }),
      })
      if (res.ok) {
        setNewName('')
        setShowSaveInput(false)
        void fetchLists()
      }
    } finally {
      setSaving(false)
    }
  }

  const deleteList = async (listId: string) => {
    if (!confirm('Delete this smart list?')) return
    await fetch(`/api/smart-lists/${listId}`, { method: 'DELETE' })
    void fetchLists()
  }

  if (lists.length === 0 && !hasActiveFilters) return null

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {lists.map((list) => (
          <button
            key={list.id}
            onClick={() => onSelectList(list)}
            className={`inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
              activeListId === list.id
                ? 'bg-teal-600 text-white'
                : 'bg-white border border-gray-300 text-ink3 hover:border-teal-400 hover:text-teal-700'
            }`}
          >
            {list.name}
            <span
              onClick={(e) => {
                e.stopPropagation()
                void deleteList(list.id)
              }}
              className={`cursor-pointer text-sm leading-none transition-colors ${
                activeListId === list.id
                  ? 'text-teal-200 hover:text-white'
                  : 'text-gray-400 hover:text-red-500'
              }`}
            >
              &times;
            </span>
          </button>
        ))}

        {hasActiveFilters && !showSaveInput && (
          <button
            onClick={() => setShowSaveInput(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border border-dashed border-teal-400 text-teal-600 hover:bg-teal-50 transition-colors shrink-0"
          >
            + Save filters
          </button>
        )}

        {showSaveInput && (
          <div className="inline-flex items-center gap-1.5 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="List name..."
              className="text-xs border border-border-brand rounded-full px-3 py-1.5 w-32 focus:outline-none focus:ring-1 focus:ring-teal-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveList()
                if (e.key === 'Escape') {
                  setShowSaveInput(false)
                  setNewName('')
                }
              }}
            />
            <button
              onClick={() => void saveList()}
              disabled={!newName.trim() || saving}
              className="text-xs font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setShowSaveInput(false)
                setNewName('')
              }}
              className="text-xs text-ink4 hover:text-ink3"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
