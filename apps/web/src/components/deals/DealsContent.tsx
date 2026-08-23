'use client'

import { useState, useEffect } from 'react'
import { Suspense } from 'react'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import DealsKanban from './DealsKanban'
import DealsList from './DealsList'

const LS_KEY = 'nuatis_pipeline_view'

function GridIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  )
}

export default function DealsContent() {
  const [view, setView] = useState<'board' | 'list'>('board')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved === 'list') setView('list')
    setMounted(true)
  }, [])

  function switchView(v: 'board' | 'list') {
    setView(v)
    localStorage.setItem(LS_KEY, v)
  }

  const toggle = (
    <ToggleButtonGroup
      value={view}
      exclusive
      onChange={(_e, v: 'board' | 'list' | null) => v && switchView(v)}
      size="small"
    >
      <ToggleButton value="board" title="Board view" aria-label="Board view">
        <GridIcon />
      </ToggleButton>
      <ToggleButton value="list" title="List view" aria-label="List view">
        <ListIcon />
      </ToggleButton>
    </ToggleButtonGroup>
  )

  if (!mounted) return null

  return (
    <Suspense fallback={null}>
      {view === 'board' ? <DealsKanban viewToggle={toggle} /> : <DealsList viewToggle={toggle} />}
    </Suspense>
  )
}
