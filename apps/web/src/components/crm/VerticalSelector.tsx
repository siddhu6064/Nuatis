'use client'

import { VERTICALS } from '@nuatis/shared'

const VERTICALS_LIST = Object.entries(VERTICALS).map(([slug, config]) => ({
  slug,
  label: config.label,
}))

const VERTICAL_ICONS: Record<string, string> = {
  sales_crm: '📊',
  dental: '🦷',
  salon: '✂️',
  restaurant: '🍽️',
  contractor: '🔧',
  law_firm: '⚖️',
  real_estate: '🏠',
}

interface VerticalSelectorProps {
  value: string
  onChange: (slug: string) => void
}

export function VerticalSelector({ value, onChange }: VerticalSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {VERTICALS_LIST.map((vertical) => {
        const selected = value === vertical.slug
        return (
          <button
            key={vertical.slug}
            type="button"
            onClick={() => onChange(vertical.slug)}
            className={`
              flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center
              transition-all cursor-pointer
              ${
                selected
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-border-brand bg-white text-ink3 hover:border-border-brand hover:bg-bg'
              }
            `}
          >
            <span className="text-2xl">{VERTICAL_ICONS[vertical.slug] ?? '🏢'}</span>
            <span className="text-sm font-medium leading-tight">{vertical.label}</span>
          </button>
        )
      })}
    </div>
  )
}
