'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface ActivityItem {
  id: string
  contact_id: string | null
  contact_name: string | null
  type: string
  body: string | null
  actor_type: string
  actor_name: string | null
  created_at: string
}

const TYPE_ICON: Record<string, string> = {
  call: '📞',
  note: '📝',
  email: '✉️',
  sms: '💬',
  appointment: '📅',
  deal_created: '💼',
  stage_change: '→',
  task: '✓',
  system: '⚙',
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function SkeletonRow() {
  return (
    <div className="flex gap-3 animate-pulse py-2">
      <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
      <div className="flex-1 space-y-1.5 pt-0.5">
        <div className="h-3 bg-gray-100 rounded w-3/4" />
        <div className="h-2.5 bg-gray-100 rounded w-1/2" />
      </div>
    </div>
  )
}

export default function RecentActivity() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/activity?limit=10', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { items: ActivityItem[] }) => {
        setItems(d.items ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="col-span-1 md:col-span-2 bg-white rounded-xl border border-border-brand p-6">
      <h2 className="text-sm font-semibold text-ink mb-4">Recent Activity</h2>

      {loading ? (
        <div className="space-y-1 divide-y divide-gray-50">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center mb-3">
            <span className="text-gray-300 text-xl">◎</span>
          </div>
          <p className="text-sm font-medium text-ink4">No activity yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Activity will appear here as you add contacts
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-50 -mx-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 px-1 py-2.5 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-bg2 flex items-center justify-center text-sm shrink-0">
                {TYPE_ICON[item.type] ?? '●'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-ink leading-snug truncate">{item.body ?? item.type}</p>
                <p className="text-[10px] text-ink4 mt-0.5">
                  {item.contact_id ? (
                    <Link
                      href={`/contacts/${item.contact_id}`}
                      className="text-teal-600 hover:underline"
                    >
                      {item.contact_name ?? 'Contact'}
                    </Link>
                  ) : null}
                  {item.contact_id && item.actor_name ? ' · ' : null}
                  {item.actor_name ?? null}
                </p>
              </div>
              <span className="text-[10px] text-ink4 shrink-0 pt-0.5 tabular-nums">
                {timeAgo(item.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
