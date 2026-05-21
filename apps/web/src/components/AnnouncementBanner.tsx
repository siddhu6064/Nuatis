'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''
const LS_KEY = 'nuatis_dismissed_announcements'

interface Announcement {
  id: string
  title: string
  body: string
  type: 'feature' | 'maintenance' | 'tip' | 'update'
  cta_label: string | null
  cta_url: string | null
}

const TYPE_STYLE: Record<string, { border: string; bg: string; icon: string }> = {
  feature:     { border: 'border-teal-300',  bg: 'bg-teal-50',  icon: '🚀' },
  maintenance: { border: 'border-amber-300', bg: 'bg-amber-50', icon: '⚠️' },
  tip:         { border: 'border-blue-300',  bg: 'bg-blue-50',  icon: '💡' },
  update:      { border: 'border-gray-300',  bg: 'bg-gray-50',  icon: '📣' },
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  useEffect(() => {
    const dismissed: string[] = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    fetch(`${API_URL}/api/announcements`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { announcements?: Announcement[] } | null) => {
        const list = d?.announcements ?? []
        const next = list.find((a: Announcement) => !dismissed.includes(a.id))
        setAnnouncement(next ?? null)
      })
      .catch(() => {})
  }, [])

  function dismiss() {
    if (!announcement) return
    const dismissed: string[] = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    localStorage.setItem(LS_KEY, JSON.stringify([...dismissed, announcement.id]))
    setAnnouncement(null)
  }

  if (!announcement) return null
  const style = TYPE_STYLE[announcement.type] ?? TYPE_STYLE['feature']!

  return (
    <div className={`border-b ${style.border} ${style.bg} px-4 py-3 flex items-start gap-3`}>
      <span className="text-base leading-none mt-0.5 flex-shrink-0">{style.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink">{announcement.title}</p>
        <p className="text-xs text-ink3 mt-0.5">{announcement.body}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {announcement.cta_label && announcement.cta_url && (
          <Link href={announcement.cta_url} className="text-xs font-medium text-teal-600 hover:text-teal-700 whitespace-nowrap">
            {announcement.cta_label} →
          </Link>
        )}
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-ink4 hover:text-ink text-xl leading-none">×</button>
      </div>
    </div>
  )
}
