'use client'

import { useState } from 'react'
import AutomationOverviewClient from './AutomationOverviewClient'
import CustomAutomationBuilder from './CustomAutomationBuilder'

interface Props {
  settingsContent: React.ReactNode
}

const TAB_LABELS: Record<'overview' | 'custom' | 'settings', string> = {
  overview: 'Overview',
  custom: 'Custom',
  settings: 'Settings',
}

export default function AutomationTabs({ settingsContent }: Props) {
  const [tab, setTab] = useState<'overview' | 'custom' | 'settings'>('overview')

  return (
    <>
      {/* Tab nav */}
      <div className="flex gap-1 mb-6 border-b border-border-brand">
        {(['overview', 'custom', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'overview' && <AutomationOverviewClient />}
      {tab === 'custom' && <CustomAutomationBuilder />}
      {tab === 'settings' && settingsContent}
    </>
  )
}
