'use client'

import { useEffect, useState } from 'react'

interface Notice {
  id: string
  message: string | null
  published_at: string
  resolved_at: string | null
}

const DISMISSED_KEY = 'nuatis.platform-notices.dismissed'

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    // Private windows and blocked site data both throw here. A banner is not
    // worth breaking a dashboard over.
    return []
  }
}

/**
 * Tells a merchant about a platform incident that affected them.
 *
 * Renders nothing at all when there is no published notice — the overwhelmingly
 * common case, which must cost the dashboard nothing visually. A failed fetch
 * also renders nothing: a broken status notice must never break the dashboard.
 *
 * Only `message`, `published_at` and `resolved_at` are rendered, because those
 * are the only fields /api/platform-notices returns. The incident's internal
 * title, summary and timeline are not on that endpoint's path at all.
 */
export function PlatformNoticeBanner() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])

  useEffect(() => {
    setDismissed(readDismissed())
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/platform-notices')
        if (!res.ok) return
        const body = (await res.json()) as { notices: Notice[] }
        if (!cancelled) setNotices(body.notices ?? [])
      } catch {
        // Silent on purpose. See the docblock.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function dismiss(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      // Dismissal not persisting is a small annoyance; throwing is not.
    }
  }

  const visible = notices.filter((n) => n.message && !dismissed.includes(n.id))
  if (visible.length === 0) return null

  return (
    <div className="px-8 pt-4 space-y-2">
      {visible.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <div className="flex-1">
            <p className="text-sm text-ink">{n.message}</p>
            <p className="text-xs text-ink4 mt-0.5">
              {new Date(n.published_at).toLocaleString()}
              {n.resolved_at ? ' · resolved' : ' · ongoing'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            className="text-xs text-ink3 hover:text-ink"
            aria-label="Dismiss notice"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
