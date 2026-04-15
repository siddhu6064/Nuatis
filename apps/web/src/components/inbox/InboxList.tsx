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
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [loading, setLoading] = useState(true)

  const fetchInbox = useCallback(async () => {
    try {
      // Fetch unread SMS grouped by contact
      const res = await fetch('/api/sms/unread-count')
      if (!res.ok) return

      // Fetch contacts with unread messages
      // We need the full thread data — fetch inbound_sms grouped
      const smsRes = await fetch('/api/contacts?has_unread_sms=true&limit=50')
      if (!smsRes.ok) return
      const data = (await smsRes.json()) as {
        contacts: Array<{
          id: string
          full_name: string
        }>
      }

      // For each contact, get their last message + unread count
      const threadPromises = data.contacts.map(async (c) => {
        const threadRes = await fetch(`/api/contacts/${c.id}/sms`)
        if (!threadRes.ok) return null
        const threadData = (await threadRes.json()) as {
          messages: Array<{ body: string; created_at: string; direction: string }>
          unread_count: number
        }
        const lastMsg = threadData.messages[threadData.messages.length - 1]
        return {
          contact_id: c.id,
          contact_name: c.full_name,
          last_message: lastMsg?.body ?? '',
          last_message_at: lastMsg?.created_at ?? '',
          unread_count: threadData.unread_count,
        }
      })

      const results = (await Promise.all(threadPromises)).filter(
        (t): t is InboxThread => t !== null && t.unread_count > 0
      )
      results.sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      )
      setThreads(results)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void fetchInbox().finally(() => setLoading(false))
  }, [fetchInbox])

  const markAllRead = async () => {
    for (const t of threads) {
      await fetch(`/api/contacts/${t.contact_id}/sms/read`, { method: 'POST' })
    }
    setThreads([])
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Loading inbox...</div>
  }

  if (threads.length === 0) {
    return (
      <div className="py-12 text-center">
        <span className="text-3xl">{'\u2713'}</span>
        <p className="text-sm font-medium text-gray-600 mt-2">No unread messages</p>
        <p className="text-xs text-gray-400 mt-1">All caught up</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{threads.length} unread conversations</p>
        <button
          onClick={() => void markAllRead()}
          className="text-xs text-teal-600 hover:text-teal-700 font-medium"
        >
          Mark all read
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
        {threads.map((t) => (
          <button
            key={t.contact_id}
            onClick={() => router.push(`/contacts/${t.contact_id}?tab=messages`)}
            className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
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
                <span className="text-sm font-medium text-gray-900 truncate">{t.contact_name}</span>
                <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                  {t.last_message_at ? timeAgo(t.last_message_at) : ''}
                </span>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">
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
      </div>
    </div>
  )
}
