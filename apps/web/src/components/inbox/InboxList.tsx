'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface InboxThread {
  contact_id: string
  contact_name: string
  last_message: string
  last_message_at: string
  unread_count: number
}

interface ChatSession {
  id: string
  visitor_name: string | null
  last_message: string | null
  last_message_at: string | null
  unread_count: number
}

type InboxTab = 'sms' | 'chat' | 'all'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function InboxList() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<InboxTab>('all')
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSmsThreads = useCallback(async (): Promise<InboxThread[]> => {
    try {
      const res = await fetch('/api/conversations?status=open&limit=50')
      if (!res.ok) return []
      const data = (await res.json()) as {
        conversations: Array<{
          contact_id: string
          contact_name: string | null
          last_message: string | null
          last_message_at: string | null
          unread_count: number
        }>
      }
      return (data.conversations ?? []).map((c) => ({
        contact_id: c.contact_id,
        contact_name: c.contact_name ?? 'Unknown',
        last_message: c.last_message ?? '',
        last_message_at: c.last_message_at ?? '',
        unread_count: c.unread_count,
      }))
    } catch {
      return []
    }
  }, [])

  const fetchChatSessions = useCallback(async (): Promise<ChatSession[]> => {
    try {
      const res = await fetch('/api/chat/sessions?status=active')
      if (!res.ok) return []
      const data = (await res.json()) as {
        sessions: Array<{
          id: string
          visitor_name?: string | null
          last_message?: string | null
          last_message_at?: string | null
          unread_count?: number
        }>
      }
      return (data.sessions ?? []).map((s) => ({
        id: s.id,
        visitor_name: s.visitor_name ?? null,
        last_message: s.last_message ?? null,
        last_message_at: s.last_message_at ?? null,
        unread_count: s.unread_count ?? 0,
      }))
    } catch {
      return []
    }
  }, [])

  const fetchAll = useCallback(async () => {
    const [sms, chat] = await Promise.all([fetchSmsThreads(), fetchChatSessions()])
    setThreads(sms)
    setChatSessions(chat)
  }, [fetchSmsThreads, fetchChatSessions])

  useEffect(() => {
    setLoading(true)
    void fetchAll().finally(() => setLoading(false))
  }, [fetchAll])

  const markAllRead = async () => {
    for (const t of threads) {
      await fetch(`/api/contacts/${t.contact_id}/sms/read`, { method: 'POST' })
    }
    setThreads([])
  }

  const visibleSms = activeTab === 'chat' ? [] : threads
  const visibleChat = activeTab === 'sms' ? [] : chatSessions
  const totalVisible = visibleSms.length + visibleChat.length

  const tabs: Array<{ key: InboxTab; label: string; count: number }> = [
    { key: 'all', label: 'All', count: threads.length + chatSessions.length },
    { key: 'sms', label: 'SMS', count: threads.length },
    { key: 'chat', label: 'Chat', count: chatSessions.length },
  ]

  if (loading) {
    return <div className="py-12 text-center text-sm text-ink4">Loading inbox...</div>
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-border-brand">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-teal-700 border-b-2 border-teal-600'
                : 'text-ink3 hover:text-ink2'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === tab.key ? 'bg-teal-100 text-teal-700' : 'bg-bg2 text-ink3'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}

        {activeTab !== 'chat' && threads.length > 0 && (
          <button
            onClick={() => void markAllRead()}
            className="ml-auto text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-2"
          >
            Mark all read
          </button>
        )}
      </div>

      {totalVisible === 0 ? (
        <div className="py-12 text-center">
          <span className="text-3xl">{'\u2713'}</span>
          <p className="text-sm font-medium text-ink3 mt-2">No open conversations</p>
          <p className="text-xs text-ink4 mt-1">All caught up</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand divide-y divide-gray-50">
          {/* SMS threads */}
          {visibleSms.map((t) => (
            <button
              key={`sms-${t.contact_id}`}
              onClick={() => router.push(`/contacts/${t.contact_id}?tab=messages`)}
              className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-bg transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                <span className="text-teal-700 text-xs font-bold">
                  {t.contact_name
                    .split(' ')
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink truncate">{t.contact_name}</span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="text-[9px] bg-bg2 text-ink3 px-1.5 py-0.5 rounded font-medium">
                      SMS
                    </span>
                    <span className="text-[10px] text-ink4">
                      {t.last_message_at ? timeAgo(t.last_message_at) : ''}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-ink3 truncate mt-0.5">
                  {t.last_message.slice(0, 60)}
                  {t.last_message.length > 60 ? '...' : ''}
                </p>
              </div>
              {t.unread_count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white shrink-0">
                  {t.unread_count}
                </span>
              )}
            </button>
          ))}

          {/* Chat sessions */}
          {visibleChat.map((s) => {
            const visitorLabel = s.visitor_name ?? 'Website Visitor'
            const initials = visitorLabel
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()
            return (
              <button
                key={`chat-${s.id}`}
                onClick={() => router.push(`/inbox?chat=${s.id}`)}
                className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-bg transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <span className="text-blue-700 text-xs font-bold">{initials || 'W'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink truncate">{visitorLabel}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                        Chat
                      </span>
                      <span className="text-[10px] text-ink4">
                        {s.last_message_at ? timeAgo(s.last_message_at) : ''}
                      </span>
                    </div>
                  </div>
                  {s.last_message && (
                    <p className="text-xs text-ink3 truncate mt-0.5">
                      {s.last_message.slice(0, 60)}
                      {s.last_message.length > 60 ? '...' : ''}
                    </p>
                  )}
                </div>
                {s.unread_count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white shrink-0">
                    {s.unread_count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
