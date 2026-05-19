'use client'

import { useEffect, useState } from 'react'

interface GbpInsights {
  connected: true
  queries_direct: number
  queries_indirect: number
  views_maps: number
  views_search: number
  actions_website: number
  actions_phone: number
  actions_driving_directions: number
  period_days: number
}

interface NotConnected {
  connected: false
}

type InsightsData = GbpInsights | NotConnected | null

const METRICS = [
  { key: 'queries_direct', label: 'Direct Searches', icon: '🔍' },
  { key: 'queries_indirect', label: 'Discovery Searches', icon: '🧭' },
  { key: 'views_maps', label: 'Maps Views', icon: '📍' },
  { key: 'views_search', label: 'Search Views', icon: '👁' },
  { key: 'actions_website', label: 'Website Clicks', icon: '🌐' },
  { key: 'actions_phone', label: 'Phone Calls', icon: '📞' },
  { key: 'actions_driving_directions', label: 'Direction Requests', icon: '🗺' },
] as const

export default function GbpInsightsWidget() {
  const [data, setData] = useState<InsightsData>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reputation/insights')
      .then((res) => res.json())
      .then((json) => {
        setData(json)
      })
      .catch(() => {
        setData({ connected: false })
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="mt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-24" />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.connected === false) {
    return (
      <div className="mt-4">
        <div className="bg-white rounded-xl border border-border-brand p-5 text-sm text-ink3">
          <span className="font-medium text-ink">Google Business Profile</span> not connected.{' '}
          <a href="/settings/reputation" className="text-teal-600 underline">
            Connect in Settings → Reputation
          </a>{' '}
          to see search insights.
        </div>
      </div>
    )
  }

  const insights = data as GbpInsights

  return (
    <div className="mt-4">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-ink">Google Business Profile</h2>
        <p className="text-xs text-ink3 mt-0.5">Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {METRICS.map(({ key, label, icon }) => (
          <div key={key} className="bg-white rounded-xl border border-border-brand p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-ink3">{label}</p>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm bg-teal-50 text-teal-600">
                {icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-ink">{insights[key].toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
