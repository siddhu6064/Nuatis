'use client'

import { useState } from 'react'
import AutomationOverviewClient from './AutomationOverviewClient'

interface Props {
  settingsContent: React.ReactNode
}

export default function AutomationTabs({ settingsContent }: Props) {
  const [tab, setTab] = useState<'overview' | 'settings'>('overview')

  return (
    <>
      {/* Tab nav */}
      <div className="flex gap-1 mb-6 border-b border-border-brand">
        {(['overview', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            {t === 'overview' ? 'Overview' : 'Settings'}
          </button>
        ))}
      </div>
      {tab === 'overview' ? <AutomationOverviewClient /> : settingsContent}
    </>
  )
}
