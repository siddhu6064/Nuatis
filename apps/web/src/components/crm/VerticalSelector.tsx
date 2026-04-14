'use client'

const VERTICALS_LIST = [
  { slug: 'sales_crm', label: 'Sales CRM' },
  { slug: 'dental', label: 'Dental practice' },
  { slug: 'salon', label: 'Hair salon' },
  { slug: 'restaurant', label: 'Restaurant' },
  { slug: 'contractor', label: 'Contractor' },
  { slug: 'law_firm', label: 'Law firm' },
  { slug: 'real_estate', label: 'Real estate' },
]

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
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
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
