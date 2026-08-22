'use client'

import { useState } from 'react'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import StaffRoster from './StaffRoster'
import StaffCalendar from './StaffCalendar'

type Tab = 'roster' | 'schedule'

interface Props {
  pageTitle: string
}

export default function StaffPage({ pageTitle }: Props) {
  const [tab, setTab] = useState<Tab>('roster')

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">{pageTitle}</h1>
          <p className="text-sm text-ink4 mt-0.5">
            Manage team members, availability, and weekly shifts
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_e, v: Tab) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="roster" label="Roster" />
        <Tab value="schedule" label="Schedule" />
      </Tabs>

      {tab === 'roster' ? <StaffRoster /> : <StaffCalendar />}
    </div>
  )
}
