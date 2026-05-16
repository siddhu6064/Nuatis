'use client'

import { useState, useEffect } from 'react'
import { VERTICALS as VERTICALS_CONFIG } from '@nuatis/shared'

const DEMO_TENANT_IDS = [
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08', // old demo
  '018323e5-4866-486e-bc90-15cfeb910fc4', // new demo
]

const VERTICAL_ICONS: Record<string, string> = {
  sales_crm: '📊',
  dental: '🦷',
  medical: '🏥',
  veterinary: '🐾',
  salon: '✂️',
  spa: '💆',
  restaurant: '🍽️',
  contractor: '🔧',
  law_firm: '⚖️',
  real_estate: '🏠',
  gym: '🏋️',
  nail_bar: '💅',
  pet_grooming: '🐕',
  tattoo: '🎨',
  car_wash: '🚗',
  laundry: '👕',
}

const VERTICALS = Object.entries(VERTICALS_CONFIG).map(([slug, config]) => ({
  slug,
  label: config.label,
  icon: VERTICAL_ICONS[slug] ?? '🏢',
}))

const GROUPS: { label: string; slugs: string[] }[] = [
  {
    label: 'SERVICES',
    slugs: [
      'salon',
      'spa',
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

const GROUPED = GROUPS.map((g) => ({
  label: g.label,
  items: g.slugs
    .map((slug) => VERTICALS.find((v) => v.slug === slug))
    .filter((v): v is (typeof VERTICALS)[0] => v !== undefined),
})).filter((g) => g.items.length > 0)

interface DemoInfo {
  tenantId: string
  vertical: string
}

export default function DemoBanner() {
  const [info, setInfo] = useState<DemoInfo | null>(null)
  const [switching, setSwitching] = useState(false)
  const [open, setOpen] = useState(false)

  // Check if we're the demo tenant via session cookie (next-auth session endpoint)
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((session: { user?: { tenantId?: string; vertical?: string } }) => {
        if (session?.user?.tenantId && DEMO_TENANT_IDS.includes(session.user.tenantId)) {
          setInfo({
            tenantId: session.user.tenantId,
            vertical: session.user.vertical ?? 'sales_crm',
          })
        }
      })
      .catch(() => {})
  }, [])

  if (!info) return null

  const current = VERTICALS.find((v) => v.slug === info.vertical) ?? VERTICALS[0]!

  async function switchVertical(slug: string) {
    setSwitching(true)
    setOpen(false)
    try {
      const res = await fetch('/api/demo/switch-vertical', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vertical: slug }),
      })
      if (res.ok) {
        window.location.reload()
      }
    } catch {
      // silently fail
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-3">
      <span className="text-xs font-semibold text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded">
        DEMO
      </span>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={switching}
          className="flex items-center gap-1.5 text-sm font-medium text-amber-800 hover:text-amber-900 disabled:opacity-50"
        >
          <span>{current.icon}</span>
          <span>{current.label}</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute top-full left-0 mt-2 bg-white rounded-xl border border-border-brand shadow-lg z-20 p-4 w-[calc(100vw-2rem)] md:w-auto md:min-w-[560px]">
              {/* Mobile: 2-column layout */}
              <div className="grid grid-cols-2 gap-4 md:hidden">
                {/* Left col: SERVICES */}
                {GROUPED.filter((g) => g.label === 'SERVICES').map((group) => (
                  <div key={group.label}>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-ink3 border-b border-border-brand pb-2 mb-3">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map((v) => {
                        const active = v.slug === info.vertical
                        return (
                          <button
                            key={v.slug}
                            onClick={() => void switchVertical(v.slug)}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${active ? 'text-teal-700 font-medium bg-teal-50' : 'text-ink2 hover:bg-bg'}`}
                          >
                            <span>{v.icon}</span>
                            <span>{v.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {/* Right col: HEALTHCARE + PROFESSIONAL stacked */}
                <div className="space-y-4">
                  {GROUPED.filter((g) => g.label !== 'SERVICES').map((group) => (
                    <div key={group.label}>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-ink3 border-b border-border-brand pb-2 mb-3">
                        {group.label}
                      </p>
                      <div className="space-y-0.5">
                        {group.items.map((v) => {
                          const active = v.slug === info.vertical
                          return (
                            <button
                              key={v.slug}
                              onClick={() => void switchVertical(v.slug)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors ${active ? 'text-teal-700 font-medium bg-teal-50' : 'text-ink2 hover:bg-bg'}`}
                            >
                              <span>{v.icon}</span>
                              <span>{v.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Desktop: 3-column grid */}
              <div className="hidden md:grid grid-cols-3 gap-6">
                {GROUPED.map((group) => (
                  <div key={group.label}>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-ink3 border-b border-border-brand pb-2 mb-3">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map((v) => {
                        const active = v.slug === info.vertical
                        return (
                          <button
                            key={v.slug}
                            onClick={() => void switchVertical(v.slug)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                              active
                                ? 'text-teal-700 font-medium border-l-2 border-teal-500 pl-2.5 bg-teal-50'
                                : 'text-ink2 hover:bg-bg border-l-2 border-transparent pl-2.5'
                            }`}
                          >
                            <span>{v.icon}</span>
                            <span>{v.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="border-t border-border-brand pt-3 mt-3 flex items-center justify-between">
                <span className="font-mono text-[10px] text-ink4">
                  16 industries · More on the way
                </span>
                <a
                  href="mailto:sid@nuatis.com"
                  className="font-mono text-[10px] text-teal-600 hover:text-teal-800 transition-colors"
                >
                  Don&apos;t see yours? Tell us →
                </a>
              </div>
            </div>
          </>
        )}
      </div>
      <span className="text-xs text-amber-600 ml-auto hidden sm:inline">
        Switch vertical for demo
      </span>
      {/* Mobile: icon-only call link */}
      <a
        href="tel:+15127376322"
        className="md:hidden ml-auto flex items-center gap-1 text-xs font-medium text-amber-700"
        aria-label="Call +1 512 737 6322"
      >
        <span>📞</span>
        <span>Call Maya</span>
      </a>
      {/* Desktop: full call text */}
      <span className="hidden md:inline font-mono text-[11px] tracking-wide ml-auto sm:ml-2 whitespace-nowrap">
        <span className="text-[#7a7468]">📞&nbsp;Call </span>
        <a href="tel:+15127376322" className="text-[#0d9488] hover:underline">
          +1 512 737 6322
        </a>
        <span className="text-[#7a7468]"> to see Maya in action</span>
      </span>
    </div>
  )
}
