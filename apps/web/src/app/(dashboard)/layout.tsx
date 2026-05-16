'use client'

import { useState, useCallback } from 'react'
import { SessionProvider } from 'next-auth/react'
import Sidebar from './Sidebar'
import DemoBanner from './DemoBanner'
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt'
import { NPSSurvey } from '@/components/NPSSurvey'
import GlobalSearch from '@/components/search/GlobalSearch'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <SessionProvider>
      <div className="flex h-screen bg-bg overflow-hidden">
        <div
          className={`fixed inset-0 z-20 md:hidden transition-opacity duration-200 ${sidebarOpen ? 'bg-black/40 pointer-events-auto' : 'pointer-events-none opacity-0'}`}
          onClick={closeSidebar}
        />
        <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        <main className="flex-1 overflow-y-auto bg-bg">
          <div
            className={`relative flex items-center px-4 pt-4 md:hidden ${sidebarOpen ? 'hidden' : ''}`}
            style={{ zIndex: 50 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setSidebarOpen(true)
              }}
              className="p-2 rounded-lg text-ink3 hover:bg-bg transition-colors"
              aria-label="Open menu"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
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
