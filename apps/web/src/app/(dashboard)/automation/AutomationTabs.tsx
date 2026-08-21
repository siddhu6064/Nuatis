'use client'

import { useState } from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
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
      <Tabs
        value={tab}
        onChange={(_e, v: 'overview' | 'custom' | 'settings') => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {(['overview', 'custom', 'settings'] as const).map((t) => (
          <Tab key={t} value={t} label={TAB_LABELS[t]} />
        ))}
      </Tabs>
      {tab === 'overview' && <AutomationOverviewClient />}
      {tab === 'custom' && <CustomAutomationBuilder />}
      {tab === 'settings' && settingsContent}
    </>
  )
}
