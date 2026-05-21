'use client'
import { useState, useRef, useEffect } from 'react'

export interface ColumnDef {
  key: string
  label: string
}

interface Props {
  columns: ColumnDef[]
  visible: Record<string, boolean>
  onChange: (key: string, visible: boolean) => void
}

export function ColumnsButton({ columns, visible, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-border-brand text-sm text-ink3 hover:text-ink hover:bg-bg transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 bg-white border border-border-brand rounded-xl shadow-lg p-3 min-w-[180px]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink4 mb-2">Show columns</p>
          {columns.map(col => (
            <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visible[col.key] ?? true}
                onChange={e => onChange(col.key, e.target.checked)}
                className="accent-teal-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-ink">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
