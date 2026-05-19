'use client'

import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

type Preset = '30' | '60' | '90' | '180'

interface MonthPoint {
  month: string
  count: number
  value: number
}

interface VelocityData {
  avgDaysToClose: number
  dealsPerMonth: number
  avgDealSize: number
  velocityPerMonth: number
  totalWon: number
  totalValue: number
  wonByMonth: MonthPoint[]
}

function getDateRange(days: number): { startDate: string; endDate: string } {
  const now = new Date()
  return {
    startDate: new Date(now.getTime() - days * 86400000).toISOString(),
    endDate: now.toISOString(),
  }
}

function fmtDollars(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-border-brand p-5 animate-pulse">
      <div className="h-7 bg-gray-100 rounded w-16 mb-2" />
      <div className="h-2.5 bg-gray-100 rounded w-24" />
    </div>
  )
}

interface StatCardProps {
  value: string
  label: string
  sub?: string
  accentTop: string
  numClass: string
  icon: React.ReactNode
}

function StatCard({ value, label, sub, accentTop, numClass, icon }: StatCardProps) {
  return (
    <div
      className={`bg-white rounded-lg border border-border-brand border-t-[3px] p-5 ${accentTop}`}
    >
      <div className="flex items-start justify-between mb-2">
        <p className={`text-2xl font-bold ${numClass}`}>{value}</p>
        <span className="text-ink4">{icon}</span>
      </div>
      <p className="text-xs font-medium text-ink3">{label}</p>
      {sub && <p className="text-[11px] text-ink4 mt-0.5">{sub}</p>}
    </div>
  )
}

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" strokeWidth="2" />
    <path strokeWidth="2" strokeLinecap="round" d="M12 6v6l4 2" />
  </svg>
)
const TrendingIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <polyline
      points="23 6 13.5 15.5 8.5 10.5 1 18"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="17 6 23 6 23 12"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const DollarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <line x1="12" y1="1" x2="12" y2="23" strokeWidth="2" strokeLinecap="round" />
    <path strokeWidth="2" strokeLinecap="round" d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
)
const ZapIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <polygon
      points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
)

export default function VelocityPage() {
  const [preset, setPreset] = useState<Preset>('90')
  const [data, setData] = useState<VelocityData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const { startDate, endDate } = getDateRange(parseInt(preset, 10))
    const params = new URLSearchParams({ startDate, endDate })
    void fetch(`/api/deals/velocity?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: VelocityData) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [preset])

  const hasData = (data?.totalWon ?? 0) > 0

  const winRate =
    data && data.totalWon > 0 ? Math.round((data.totalWon / Math.max(data.totalWon, 1)) * 100) : 0

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Sales Velocity</h1>
          <p className="text-sm text-ink3 mt-0.5">How fast deals move through your pipeline</p>
        </div>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          className="px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 bg-white text-ink2"
        >
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
          <option value="180">Last 180 days</option>
        </select>
      </div>

      {/* Row 1 — Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              value={`${data?.avgDaysToClose ?? 0}d`}
              label="Avg Days to Close"
              accentTop="border-t-blue-500"
              numClass="text-blue-700"
              icon={<ClockIcon />}
            />
            <StatCard
              value={String(data?.dealsPerMonth ?? 0)}
              label="Deals / Month"
              accentTop="border-t-teal-500"
              numClass="text-teal-700"
              icon={<TrendingIcon />}
            />
            <StatCard
              value={fmtDollars(data?.avgDealSize ?? 0)}
              label="Avg Deal Size"
              accentTop="border-t-green-500"
              numClass="text-green-700"
              icon={<DollarIcon />}
            />
            <StatCard
              value={fmtDollars(data?.velocityPerMonth ?? 0)}
              label="$/Month Velocity"
              sub={`${data?.totalWon ?? 0} deals won`}
              accentTop="border-t-purple-500"
              numClass="text-purple-700"
              icon={<ZapIcon />}
            />
          </>
        )}
      </div>

      {/* Row 2 — Bar chart */}
      <div className="bg-white rounded-lg border border-border-brand p-5 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-4">Won Deals by Month</h2>
        {loading ? (
          <div className="h-[260px] bg-gray-50 animate-pulse rounded" />
        ) : !hasData ? (
          <div className="flex items-center justify-center h-[260px] text-sm text-ink4">
            No won deals yet — close your first deal to see velocity metrics
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data?.wonByMonth ?? []}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => fmtDollars(v)}
              />
              <Tooltip
                formatter={(value, name) =>
                  String(name) === 'value'
                    ? [fmtDollars(Number(value ?? 0)), 'Value']
                    : [Number(value ?? 0), 'Count']
                }
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(v: string) => (v === 'count' ? 'Count' : 'Value')}
              />
              <Bar
                yAxisId="left"
                dataKey="count"
                name="count"
                fill="#0d9488"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="value"
                name="value"
                fill="#3b82f6"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Row 3 — Formula explainer */}
      {!loading && (
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs font-semibold text-ink3 mb-3 uppercase tracking-wide">
            Sales Velocity Formula
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex flex-col items-center px-3 py-2 bg-white rounded-lg border border-border-brand min-w-[80px]">
              <span className="text-base font-bold text-teal-700">{data?.dealsPerMonth ?? 0}</span>
              <span className="text-[10px] text-ink4 mt-0.5">Deals/Mo</span>
            </div>
            <span className="text-ink4 font-bold">×</span>
            <div className="flex flex-col items-center px-3 py-2 bg-white rounded-lg border border-border-brand min-w-[80px]">
              <span className="text-base font-bold text-green-700">
                {fmtDollars(data?.avgDealSize ?? 0)}
              </span>
              <span className="text-[10px] text-ink4 mt-0.5">Avg Size</span>
            </div>
            <span className="text-ink4 font-bold">×</span>
            <div className="flex flex-col items-center px-3 py-2 bg-white rounded-lg border border-border-brand min-w-[80px]">
              <span className="text-base font-bold text-amber-700">{winRate}%</span>
              <span className="text-[10px] text-ink4 mt-0.5">Win Rate</span>
            </div>
            <span className="text-ink4 font-bold">÷</span>
            <div className="flex flex-col items-center px-3 py-2 bg-white rounded-lg border border-border-brand min-w-[80px]">
              <span className="text-base font-bold text-blue-700">
                {data?.avgDaysToClose ?? 0}d
              </span>
              <span className="text-[10px] text-ink4 mt-0.5">Avg Days</span>
            </div>
            <span className="text-ink4 font-bold">=</span>
            <div className="flex flex-col items-center px-3 py-2 bg-purple-50 rounded-lg border border-purple-200 min-w-[80px]">
              <span className="text-base font-bold text-purple-700">
                {fmtDollars(data?.velocityPerMonth ?? 0)}
              </span>
              <span className="text-[10px] text-purple-500 mt-0.5">Velocity</span>
            </div>
          </div>
          <p className="text-[11px] text-ink4 mt-3">
            Sales Velocity = (Deals/Month × Avg Deal Size × Win Rate) / Avg Days to Close
          </p>
        </div>
      )}
    </div>
  )
}
