'use client'

import { useState, useEffect } from 'react'
import { Suspense } from 'react'
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
    <div className="flex items-center gap-0.5 border border-border-brand rounded-lg p-0.5">
      <button
        onClick={() => switchView('board')}
        title="Board view"
        className={`p-1.5 rounded transition-colors ${
          view === 'board' ? 'bg-bg2 text-ink' : 'text-ink4 hover:text-ink3'
        }`}
      >
        <GridIcon />
      </button>
      <button
        onClick={() => switchView('list')}
        title="List view"
        className={`p-1.5 rounded transition-colors ${
          view === 'list' ? 'bg-bg2 text-ink' : 'text-ink4 hover:text-ink3'
        }`}
      >
        <ListIcon />
      </button>
    </div>
  )

  if (!mounted) return null

  return (
    <Suspense fallback={null}>
      {view === 'board' ? <DealsKanban viewToggle={toggle} /> : <DealsList viewToggle={toggle} />}
    </Suspense>
  )
}
