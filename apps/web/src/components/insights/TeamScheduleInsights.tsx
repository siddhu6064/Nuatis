'use client'

import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface StaffRow {
  id: string
  name: string
  color_hex: string
  shift_count: number
  total_hours: number
}

interface StaffInsights {
  total_shifts_this_week: number
  avg_shift_hours: number
  busiest_staff: StaffRow | null
  by_staff: StaffRow[]
}

export default function TeamScheduleInsights() {
  const [data, setData] = useState<StaffInsights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/insights/staff')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StaffInsights | null) => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <section className="mt-8">
        <p className="text-sm text-gray-400">Loading team schedule…</p>
      </section>
    )
  }
  if (!data) return null

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Team Schedule</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Shifts This Week</p>
          <p className="text-2xl font-bold text-blue-600">{data.total_shifts_this_week}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Avg Shift Length</p>
          <p className="text-2xl font-bold text-amber-600">{data.avg_shift_hours}h</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Busiest Staff</p>
          <p className="text-2xl font-bold text-teal-600 truncate">
            {data.busiest_staff?.name ?? '—'}
          </p>
        </div>
      </div>

      {data.by_staff.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Shifts per staff member</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.by_staff} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="name"
                angle={-30}
                textAnchor="end"
                interval={0}
                tick={{ fontSize: 11, fill: '#6b7280' }}
              />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip
                formatter={
                  ((value: unknown, _name: unknown, props: unknown) => {
                    const row = (props as { payload?: StaffRow }).payload
                    if (!row) return [String(value), '']
                    return [`${value} shifts (${row.total_hours}h)`, row.name]
                  }) as never
                }
              />
              <Bar dataKey="shift_count" radius={[4, 4, 0, 0]}>
                {data.by_staff.map((entry, i) => (
                  <Cell key={i} fill={entry.color_hex} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
