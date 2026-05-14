'use client'

import { useState } from 'react'
import { VERTICALS } from '@nuatis/shared'

const VERTICAL_ICONS: Record<string, string> = {
  sales_crm: '📊',
  dental: '🦷',
  medical: '🩺',
  veterinary: '🐾',
  salon: '✂️',
  restaurant: '🍽️',
  contractor: '🔧',
  law_firm: '⚖️',
  real_estate: '🏠',
  spa: '💆',
  gym: '🏋️',
  nail_bar: '💅',
  pet_grooming: '🐩',
  tattoo: '🎨',
  car_wash: '🚗',
  laundry: '👕',
}

const GROUPS: { label: string; slugs: string[] }[] = [
  {
    label: 'SERVICES',
    slugs: [
      'salon',
      'restaurant',
      'contractor',
      'gym',
      'nail_bar',
      'pet_grooming',
      'tattoo',
      'car_wash',
      'laundry',
    ],
  },
  {
    label: 'HEALTHCARE',
    slugs: ['dental', 'medical', 'veterinary'],
  },
  {
    label: 'PROFESSIONAL',
    slugs: ['law_firm', 'real_estate', 'sales_crm'],
  },
]

const VERTICALS_MAP = Object.fromEntries(
  Object.entries(VERTICALS).map(([slug, config]) => [slug, config.label])
)

interface VerticalSwitcherProps {
  currentSlug: string
  onSwitch: (slug: string) => void
}

export function VerticalSwitcher({ currentSlug, onSwitch }: VerticalSwitcherProps) {
  const [open, setOpen] = useState(false)
  const currentLabel = VERTICALS_MAP[currentSlug] ?? currentSlug

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
        <span>{currentLabel}</span>
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
            className="absolute top-full left-0 mt-1 bg-white border border-border-brand
                       rounded-xl shadow-lg z-20 overflow-hidden
                       w-[calc(100vw-2rem)] sm:min-w-[580px] sm:w-auto"
          >
            {/* 3-column grid */}
            <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border-brand">
              {GROUPS.map((group) => (
                <div key={group.label} className="flex-1 min-w-0">
                  {/* Category label */}
                  <div className="px-3 pt-3 pb-1.5 border-b border-border-brand">
                    <p
                      className="font-mono text-[10px] uppercase tracking-widest"
                      style={{ color: '#7a7468' }}
                    >
                      {group.label}
                    </p>
                  </div>
                  {/* Items */}
                  {group.slugs.map((slug) => {
                    const label = VERTICALS_MAP[slug] ?? slug
                    const active = slug === currentSlug
                    return (
                      <button
                        key={slug}
                        onClick={() => {
                          onSwitch(slug)
                          setOpen(false)
                        }}
                        className={`
                          w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                          transition-colors
                          ${active ? 'bg-teal-50 text-teal-700 font-medium' : 'text-ink2 hover:bg-bg'}
                        `}
                      >
                        <span>{VERTICAL_ICONS[slug] ?? '🏢'}</span>
                        <span className="truncate">{label}</span>
                        {active && (
                          <span className="ml-auto text-teal-500 text-xs shrink-0">✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-border-brand bg-bg">
              <span className="font-mono text-[10px] tracking-wide" style={{ color: '#7a7468' }}>
                16 industries · More on the way
              </span>
              <a
                href="mailto:sid@nuatis.com"
                className="font-mono text-[10px] tracking-wide text-[#0d9488] hover:underline"
              >
                Don&apos;t see yours? Tell us →
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
