'use client'

import { useState, useCallback } from 'react'
import { SessionProvider } from 'next-auth/react'
import Sidebar from './Sidebar'
import DemoBanner from './DemoBanner'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt'
import { PostHogIdentify } from '@/components/PostHogIdentify'
import { NPSSurvey } from '@/components/NPSSurvey'
import GlobalSearch from '@/components/search/GlobalSearch'
import QuickActionsButton from '@/components/layout/QuickActionsButton'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <SessionProvider>
      <PostHogIdentify />
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
          {/* Desktop top bar */}
          <div className="hidden md:flex items-center justify-end gap-2 px-4 py-2 border-b border-border-brand bg-white sticky top-0 z-10">
            <QuickActionsButton />
            <button
              onClick={() =>
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
                )
              }
              className="h-8 flex items-center gap-2 px-3 rounded-lg border border-border-brand text-ink3 text-sm hover:bg-bg transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 text-ink4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                />
              </svg>
              <span className="hidden lg:inline text-ink4">Search</span>
              <kbd className="text-[10px] bg-bg2 px-1.5 py-0.5 rounded text-ink4">⌘K</kbd>
            </button>
          </div>
          <AnnouncementBanner />
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
