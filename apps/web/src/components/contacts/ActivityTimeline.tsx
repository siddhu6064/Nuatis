'use client'

import { useState, useEffect, useCallback } from 'react'

interface ActivityItem {
  id: string
  type: string
  body: string | null
  metadata: Record<string, unknown>
  actor_type: string
  actor_id: string | null
  actor_name: string | null
  created_at: string
}

interface Props {
  contactId: string
  refreshKey?: number
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  call: { icon: '\u{1F4DE}', color: 'text-purple-600 bg-purple-50' },
  note: { icon: '\u{1F4DD}', color: 'text-amber-600 bg-amber-50' },
  email: { icon: '\u2709\uFE0F', color: 'text-blue-600 bg-blue-50' },
  sms: { icon: '\u{1F4AC}', color: 'text-teal-600 bg-teal-50' },
  appointment: { icon: '\u{1F4C5}', color: 'text-green-600 bg-green-50' },
  quote: { icon: '\u{1F4C4}', color: 'text-orange-600 bg-orange-50' },
  stage_change: { icon: '\u2192', color: 'text-gray-600 bg-gray-50' },
  task: { icon: '\u2713', color: 'text-indigo-600 bg-indigo-50' },
  system: { icon: '\u2699\uFE0F', color: 'text-gray-500 bg-gray-50' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ActivityTimeline({ contactId, refreshKey }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchActivity = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('before', cursor)

      const res = await fetch(`/api/contacts/${contactId}/activity?${params}`)
      if (!res.ok) return
      const data = (await res.json()) as {
        items: ActivityItem[]
        hasMore: boolean
        nextCursor: string | null
      }

      if (cursor) {
        setItems((prev) => [...prev, ...data.items])
      } else {
        setItems(data.items)
      }
      setHasMore(data.hasMore)
      setNextCursor(data.nextCursor)
    },
    [contactId]
  )

  useEffect(() => {
    setLoading(true)
    void fetchActivity().finally(() => setLoading(false))
  }, [fetchActivity, refreshKey])

  // Separate pinned notes
  const pinned = items.filter(
    (i) => i.type === 'note' && (i.metadata as Record<string, unknown>)?.pinned === true
  )
  const unpinned = items.filter(
    (i) => !(i.type === 'note' && (i.metadata as Record<string, unknown>)?.pinned === true)
  )

  if (loading && items.length === 0) {
    return <div className="py-8 text-center text-sm text-gray-400">Loading activity...</div>
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-400">No activity yet</p>
        <p className="text-xs text-gray-300 mt-1">
          Activity will appear here as you interact with this contact
        </p>
      </div>
    )
  }

  const renderItem = (item: ActivityItem, isPinned = false) => {
    const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG['system']!
    return (
      <div
        key={item.id}
        className={`flex gap-3 px-4 py-3 ${isPinned ? 'border-l-2 border-amber-400 bg-amber-50/30' : ''}`}
      >
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs ${config.color}`}
        >
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="font-medium text-gray-600 capitalize">
              {item.type.replace('_', ' ')}
            </span>
            <span>{timeAgo(item.created_at)}</span>
            {item.actor_type === 'ai' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-100 text-teal-700">
                Maya AI
              </span>
            )}
            {item.actor_type === 'user' && item.actor_name && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                {item.actor_name}
              </span>
            )}
            {item.actor_type === 'contact' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                Client
              </span>
            )}
            {isPinned && <span className="text-amber-500">{'\u{1F4CC}'}</span>}
          </div>
          {item.body && (
            <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{item.body}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-50">
      {pinned.map((item) => renderItem(item, true))}
      {unpinned.map((item) => renderItem(item))}
      {hasMore && (
        <div className="px-4 py-3">
          <button
            onClick={() => {
              if (nextCursor) void fetchActivity(nextCursor)
            }}
            className="text-xs text-teal-600 hover:text-teal-700 font-medium"
          >
            Load more...
          </button>
        </div>
      )}
    </div>
  )
}
