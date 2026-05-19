'use client'

import { useState, useEffect } from 'react'

interface FunnelStage {
  stageId: string
  stageName: string
  position: number
  probability: number | null
  count: number
  totalValue: number
  conversionToNext: number | null
}

const BAR_COLORS = [
  { bar: 'bg-teal-500', text: 'text-white', badge: 'bg-teal-50 text-teal-700' },
  { bar: 'bg-blue-500', text: 'text-white', badge: 'bg-blue-50 text-blue-700' },
  { bar: 'bg-purple-500', text: 'text-white', badge: 'bg-purple-50 text-purple-700' },
  { bar: 'bg-green-500', text: 'text-white', badge: 'bg-green-50 text-green-700' },
  { bar: 'bg-amber-500', text: 'text-white', badge: 'bg-amber-50 text-amber-700' },
]

function formatValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toLocaleString()}`
}

function conversionColor(pct: number): string {
  if (pct > 50) return 'text-green-600'
  if (pct >= 25) return 'text-amber-600'
  return 'text-rose-600'
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="w-28 h-3 bg-gray-100 rounded shrink-0" />
      <div className="flex-1 h-6 bg-gray-100 rounded-r" />
      <div className="w-16 h-3 bg-gray-100 rounded" />
    </div>
  )
}

export default function PipelineFunnel() {
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    void fetch('/api/deals/funnel', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { stages: FunnelStage[] }) => {
        setStages(d.stages ?? [])
        setLoading(false)
        setTimeout(() => setMounted(true), 50)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalDeals = stages.reduce((s, st) => s + st.count, 0)
  const maxCount = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 mt-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">Pipeline Funnel</h2>
        <p className="text-xs text-ink3 mt-0.5">
          Default pipeline ·{' '}
          {loading ? '…' : `${totalDeals} open deal${totalDeals !== 1 ? 's' : ''}`}
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : stages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <span className="text-3xl text-gray-300 mb-2">⧩</span>
          <p className="text-sm text-ink4">No pipeline data yet</p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Bar chart — 60% */}
          <div className="flex-[3] space-y-2.5 min-w-0">
            {stages.map((stage, i) => {
              const color = BAR_COLORS[i % BAR_COLORS.length]!
              const widthPct = (stage.count / maxCount) * 100
              return (
                <div key={stage.stageId} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-ink3 truncate shrink-0">
                    {stage.stageName}
                  </span>
                  <div className="flex-1 bg-gray-50 rounded-r h-6 overflow-hidden">
                    <div
                      className={`h-full rounded-r flex items-center px-2 transition-all duration-700 ${color.bar}`}
                      style={{
                        width: mounted ? `${Math.max(widthPct, stage.count > 0 ? 4 : 0)}%` : '0%',
                      }}
                    >
                      {stage.count > 0 && (
                        <span className={`text-[10px] font-semibold leading-none ${color.text}`}>
                          {stage.count}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="w-20 text-xs text-ink3 text-right shrink-0">
                    {formatValue(stage.totalValue)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Conversion table — 40% */}
          <div className="flex-[2] min-w-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left text-ink4 font-medium pb-2 pr-2">Stage</th>
                  <th className="text-right text-ink4 font-medium pb-2 px-1">Deals</th>
                  <th className="text-right text-ink4 font-medium pb-2 px-1">Value</th>
                  <th className="text-right text-ink4 font-medium pb-2 pl-1">→ Next</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((stage, i) => {
                  const color = BAR_COLORS[i % BAR_COLORS.length]!
                  return (
                    <tr key={stage.stageId} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[80px] ${color.badge}`}
                        >
                          {stage.stageName}
                        </span>
                      </td>
                      <td className="py-2 text-right text-ink2 font-medium px-1">{stage.count}</td>
                      <td className="py-2 text-right text-ink3 px-1">
                        {formatValue(stage.totalValue)}
                      </td>
                      <td className="py-2 text-right pl-1">
                        {stage.conversionToNext !== null ? (
                          <span
                            className={`font-medium ${conversionColor(stage.conversionToNext)}`}
                          >
                            {stage.conversionToNext}%
                          </span>
                        ) : (
                          <span className="text-ink4">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
