'use client'

import { SessionProvider } from 'next-auth/react'
import Sidebar from './Sidebar'
import DemoBanner from './DemoBanner'
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt'
import { NPSSurvey } from '@/components/NPSSurvey'
import GlobalSearch from '@/components/search/GlobalSearch'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex h-screen bg-bg overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-bg">
          <DemoBanner />
          <PushNotificationPrompt />
          {children}
          <NPSSurvey />
        </main>
        <GlobalSearch />
      </div>
    </SessionProvider>
  )
}
