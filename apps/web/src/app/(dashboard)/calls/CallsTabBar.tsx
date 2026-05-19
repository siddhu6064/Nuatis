'use client'

import Link from 'next/link'

const TABS = [
  { id: 'log', label: 'Call Log', href: '/calls' },
  { id: 'metrics', label: 'Metrics', href: '/calls?tab=metrics' },
]

export default function CallsTabBar({ activeTab }: { activeTab: string }) {
  return (
    <div className="flex gap-0 border-b border-border-brand mb-6">
      {TABS.map(({ id, label, href }) => (
        <Link
          key={id}
          href={href}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === id
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-ink3 hover:text-ink2'
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  )
}
