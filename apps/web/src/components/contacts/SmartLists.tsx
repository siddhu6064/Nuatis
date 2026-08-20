'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
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
          <Chip
            key={list.id}
            label={list.name}
            onClick={() => onSelectList(list)}
            onDelete={() => void deleteList(list.id)}
            color={activeListId === list.id ? 'primary' : 'default'}
            variant={activeListId === list.id ? 'filled' : 'outlined'}
            size="small"
            sx={{ flexShrink: 0 }}
          />
        ))}

        {hasActiveFilters && !showSaveInput && (
          <Button
            onClick={() => setShowSaveInput(true)}
            size="small"
            sx={{
              borderRadius: 999,
              borderStyle: 'dashed',
              textTransform: 'none',
              flexShrink: 0,
            }}
            variant="outlined"
          >
            + Save filters
          </Button>
        )}

        {showSaveInput && (
          <div className="inline-flex items-center gap-1.5 shrink-0">
            <TextField
              inputRef={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="List name..."
              size="small"
              sx={{ width: 128, '& .MuiOutlinedInput-root': { borderRadius: 999 } }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveList()
                if (e.key === 'Escape') {
                  setShowSaveInput(false)
                  setNewName('')
                }
              }}
            />
            <Button
              onClick={() => void saveList()}
              disabled={!newName.trim() || saving}
              size="small"
              sx={{ textTransform: 'none' }}
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setShowSaveInput(false)
                setNewName('')
              }}
              size="small"
              color="inherit"
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
