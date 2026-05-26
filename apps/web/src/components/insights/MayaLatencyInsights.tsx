'use client'

import { useState, useEffect } from 'react'

interface LatencyData {
  avg_agent_response_ms: number | null
  p95_agent_response_ms: number | null
  session_count: number
}

function getLatencyColor(ms: number | null): string {
  if (ms === null) return 'text-ink4'
  if (ms < 1500) return 'text-green-600'
  if (ms <= 2500) return 'text-yellow-600'
  return 'text-red-600'
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return `${ms}ms`
}

export default function MayaLatencyInsights() {
  const [data, setData] = useState<LatencyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/insights/maya-latency')
      .then((r) => r.json())
      .then((d: LatencyData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!data || data.session_count === 0) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-ink mb-1">Maya Response Latency</h2>
      <p className="text-xs text-ink4 mb-4">
        Last 30 days · {data.session_count} session{data.session_count !== 1 ? 's' : ''} with data
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border-brand p-4">
          <p className="text-xs text-ink4 mb-1">Avg response time</p>
          <p className={`text-2xl font-bold ${getLatencyColor(data.avg_agent_response_ms)}`}>
            {formatMs(data.avg_agent_response_ms)}
          </p>
          <p className="text-[11px] text-ink4 mt-1">
            {data.avg_agent_response_ms !== null && data.avg_agent_response_ms < 1500
              ? '✓ Under 1.5s SLO'
              : data.avg_agent_response_ms !== null
                ? '⚠ Above 1.5s SLO'
                : 'No data'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border-brand p-4">
          <p className="text-xs text-ink4 mb-1">P95 response time</p>
          <p className={`text-2xl font-bold ${getLatencyColor(data.p95_agent_response_ms)}`}>
            {formatMs(data.p95_agent_response_ms)}
          </p>
          <p className="text-[11px] text-ink4 mt-1">95th percentile across sessions</p>
        </div>
      </div>
    </div>
  )
}
