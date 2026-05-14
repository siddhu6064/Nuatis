'use client'

import { useState } from 'react'
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
      <div className="flex items-center gap-1 border-b border-border-brand mb-6">
        <button
          onClick={() => setTab('roster')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'roster'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-ink3 hover:text-ink'
          }`}
        >
          Roster
        </button>
        <button
          onClick={() => setTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'schedule'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-ink3 hover:text-ink'
          }`}
        >
          Schedule
        </button>
      </div>

      {tab === 'roster' ? <StaffRoster /> : <StaffCalendar />}
    </div>
  )
}
