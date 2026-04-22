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

interface TopItem {
  name: string
  quantity: number
  reorder_threshold: number
  unit: string
  status: 'red' | 'amber' | 'green'
}

interface InventoryInsights {
  total_skus: number
  total_value: number
  low_stock_count: number
  top_items: TopItem[]
}

const STATUS_COLOR: Record<'red' | 'amber' | 'green', string> = {
  red: '#EF4444',
  amber: '#F59E0B',
  green: '#10B981',
}

function truncate(label: string, max = 12): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`
}

export default function StockHealthInsights() {
  const [data, setData] = useState<InventoryInsights | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/insights/inventory')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: InventoryInsights | null) => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <section className="mt-8">
        <p className="text-sm text-gray-400">Loading stock health…</p>
      </section>
    )
  }
  if (!data) return null

  const chartData = data.top_items.map((i) => ({
    ...i,
    label: truncate(i.name),
  }))

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Stock Health</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Total SKUs</p>
          <p className="text-2xl font-bold text-gray-900">{data.total_skus}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Inventory Value</p>
          <p className="text-2xl font-bold text-teal-600">
            ${data.total_value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Low Stock Items</p>
          <p
            className={`text-2xl font-bold ${data.low_stock_count > 0 ? 'text-red-600' : 'text-green-600'}`}
          >
            {data.low_stock_count}
          </p>
        </div>
      </div>

      {data.top_items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Top 10 items (lowest quantity first)
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="label"
                angle={-30}
                textAnchor="end"
                interval={0}
                tick={{ fontSize: 11, fill: '#6b7280' }}
              />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
              <Tooltip
                formatter={
                  ((value: unknown, _name: unknown, props: unknown) => {
                    const row = (props as { payload?: TopItem }).payload
                    if (!row) return [String(value), '']
                    return [`${value} ${row.unit} (threshold: ${row.reorder_threshold})`, row.name]
                  }) as never
                }
              />
              <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={STATUS_COLOR[entry.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}
