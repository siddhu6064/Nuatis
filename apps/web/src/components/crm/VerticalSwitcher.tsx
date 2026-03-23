'use client'

import { useState } from 'react'
import { VERTICALS } from '@nuatis/shared'

const VERTICAL_ICONS: Record<string, string> = {
  sales_crm: '📊',
  dental: '🦷',
  salon: '✂️',
  restaurant: '🍽️',
  contractor: '🔧',
  law_firm: '⚖️',
  real_estate: '🏠',
}

interface VerticalSwitcherProps {
  currentSlug: string
  onSwitch: (slug: string) => void
}

export function VerticalSwitcher({ currentSlug, onSwitch }: VerticalSwitcherProps) {
  const [open, setOpen] = useState(false)
  const current = VERTICALS[currentSlug]

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200
                   rounded-lg text-sm font-medium text-amber-800 hover:bg-amber-100
                   transition-colors"
      >
        <span className="text-base">{VERTICAL_ICONS[currentSlug] ?? '🏢'}</span>
        <span>{current?.label ?? currentSlug}</span>
        <span className="text-xs bg-amber-200 text-amber-700 px-1.5 py-0.5 rounded font-semibold ml-1">
          DEMO
        </span>
        <svg
          className={`w-4 h-4 text-amber-600 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200
                          rounded-xl shadow-lg z-20 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Switch vertical
              </p>
            </div>
            {Object.values(VERTICALS).map((v) => (
              <button
                key={v.slug}
                onClick={() => {
                  onSwitch(v.slug)
                  setOpen(false)
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left
                  transition-colors
                  ${
                    v.slug === currentSlug
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <span>{VERTICAL_ICONS[v.slug] ?? '🏢'}</span>
                <span>{v.label}</span>
                {v.slug === currentSlug && <span className="ml-auto text-teal-500 text-xs">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
