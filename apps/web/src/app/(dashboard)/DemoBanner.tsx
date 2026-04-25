'use client'

import { useState, useEffect } from 'react'

const DEMO_TENANT_IDS = [
  '0d9a00b9-ce40-4702-a99c-ed23f11fdb08', // old demo
  '018323e5-4866-486e-bc90-15cfeb910fc4', // new demo
]

const VERTICALS = [
  { slug: 'sales_crm', label: 'Sales CRM', icon: '📊' },
  { slug: 'dental', label: 'Dental', icon: '🦷' },
  { slug: 'salon', label: 'Salon', icon: '✂️' },
  { slug: 'restaurant', label: 'Restaurant', icon: '🍽️' },
  { slug: 'contractor', label: 'Contractor', icon: '🔧' },
  { slug: 'law_firm', label: 'Law Firm', icon: '⚖️' },
  { slug: 'real_estate', label: 'Real Estate', icon: '🏠' },
]

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
            <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
              {VERTICALS.map((v) => (
                <button
                  key={v.slug}
                  onClick={() => switchVertical(v.slug)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                    v.slug === info.vertical
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <span className="text-xs text-amber-600 ml-auto">Switch vertical for demo</span>
    </div>
  )
}
