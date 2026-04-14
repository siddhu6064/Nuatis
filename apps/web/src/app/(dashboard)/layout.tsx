'use client'

import Sidebar from './Sidebar'
import DemoBanner from './DemoBanner'
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <DemoBanner />
        <PushNotificationPrompt />
        {children}
      </main>
    </div>
  )
}
