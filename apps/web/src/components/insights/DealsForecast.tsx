'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface DealsData {
  total_pipeline_value: number
  weighted_pipeline_value: number
  deals_by_stage: Array<{
    stage_name: string
    stage_color: string
    count: number
    total_value: number
  }>
  won_this_month: { count: number; value: number }
  lost_this_month: { count: number }
  avg_deal_value: number
  avg_close_probability: number
}

export default function DealsForecast() {
  const [data, setData] = useState<DealsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/insights/deals')
      .then((r) => r.json())
      .then((d: DealsData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!data || (data.total_pipeline_value === 0 && data.deals_by_stage.length === 0)) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Pipeline Forecast</h2>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Pipeline Value</p>
          <p className="text-2xl font-bold text-gray-900">
            ${data.total_pipeline_value.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Weighted Forecast</p>
          <p className="text-2xl font-bold text-teal-600">
            ${data.weighted_pipeline_value.toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">Probability-adjusted</p>
        </div>
        <div className="bg-white rounded-xl border border-green-100 p-4">
          <p className="text-xs text-green-600 mb-1">Won This Month</p>
          <p className="text-2xl font-bold text-green-700">{data.won_this_month.count}</p>
          <p className="text-[11px] text-green-500 mt-1">
            ${data.won_this_month.value.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Lost This Month</p>
          <p className="text-2xl font-bold text-gray-500">{data.lost_this_month.count}</p>
        </div>
      </div>

      {data.deals_by_stage.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Deals by Stage</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, data.deals_by_stage.length * 40)}>
            <BarChart data={data.deals_by_stage} layout="vertical" margin={{ left: 100 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="stage_name" tick={{ fontSize: 11 }} width={100} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Value']}
              />
              <Bar dataKey="total_value" fill="#0d9488" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
