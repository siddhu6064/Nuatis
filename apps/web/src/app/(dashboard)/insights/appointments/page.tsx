'use client'

import { useState, useEffect, useRef } from 'react'

type Preset = '7d' | '30d' | '90d' | 'this_month'

interface ReportData {
  statusCounts: {
    scheduled: number
    confirmed: number
    completed: number
    no_show: number
    canceled: number
    rescheduled: number
    new: number
    invalid: number
  }
  channelCounts: {
    phone_call: number
    web_booking: number
    sms: number
    manual: number
  }
  topCalendars: { calendarId: string; calendarName: string; count: number }[]
  totalAppointments: number
  showRate: number
}

const STATUS_CONFIG = [
  { key: 'scheduled', label: 'Scheduled', border: 'border-t-blue-500', num: 'text-blue-700' },
  { key: 'confirmed', label: 'Confirmed', border: 'border-t-teal-500', num: 'text-teal-700' },
  { key: 'completed', label: 'Showed', border: 'border-t-green-500', num: 'text-green-700' },
  { key: 'no_show', label: 'No Show', border: 'border-t-amber-500', num: 'text-amber-700' },
  { key: 'invalid', label: 'Invalid', border: 'border-t-gray-300', num: 'text-gray-500' },
  { key: 'canceled', label: 'Cancelled', border: 'border-t-rose-500', num: 'text-rose-700' },
  { key: 'new', label: 'New', border: 'border-t-blue-400', num: 'text-blue-700' },
  {
    key: 'rescheduled',
    label: 'Rescheduled',
    border: 'border-t-purple-500',
    num: 'text-purple-700',
  },
] as const

const CHANNEL_CONFIG = [
  { key: 'phone_call' as const, label: 'Phone Call', icon: '📞', bar: 'bg-teal-500' },
  { key: 'web_booking' as const, label: 'Web Booking', icon: '🌐', bar: 'bg-blue-500' },
  { key: 'sms' as const, label: 'SMS', icon: '💬', bar: 'bg-purple-500' },
  { key: 'manual' as const, label: 'Manual', icon: '✏️', bar: 'bg-amber-500' },
]

function getDateRange(preset: Preset): { startDate: string; endDate: string } {
  const now = new Date()
  const end = now.toISOString()
  switch (preset) {
    case '7d':
      return { startDate: new Date(now.getTime() - 7 * 86400000).toISOString(), endDate: end }
    case '30d':
      return { startDate: new Date(now.getTime() - 30 * 86400000).toISOString(), endDate: end }
    case '90d':
      return { startDate: new Date(now.getTime() - 90 * 86400000).toISOString(), endDate: end }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { startDate: start.toISOString(), endDate: end }
    }
  }
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-border-brand p-4 animate-pulse">
      <div className="h-7 bg-gray-100 rounded w-12 mb-2" />
      <div className="h-2.5 bg-gray-100 rounded w-20" />
    </div>
  )
}

function SkeletonPanel() {
  return (
    <div className="bg-white rounded-lg border border-border-brand p-5 animate-pulse space-y-3">
      <div className="h-3 bg-gray-100 rounded w-40" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-24 h-3 bg-gray-100 rounded shrink-0" />
          <div className="flex-1 h-6 bg-gray-100 rounded" />
          <div className="w-8 h-3 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

export default function AppointmentReportPage() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [barsVisible, setBarsVisible] = useState(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    setLoading(true)
    setBarsVisible(false)
    const { startDate, endDate } = getDateRange(preset)
    const params = new URLSearchParams({ startDate, endDate })
    void fetch(`/api/appointments/report?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: ReportData) => {
        setData(d)
        setLoading(false)
        setTimeout(() => setBarsVisible(true), 50)
      })
      .catch(() => setLoading(false))
  }, [preset])

  useEffect(() => {
    mountedRef.current = true
  }, [])

  const channelTotal = data
    ? data.channelCounts.phone_call +
      data.channelCounts.web_booking +
      data.channelCounts.sms +
      data.channelCounts.manual
    : 0
  const maxChannelCount = data
    ? Math.max(
        data.channelCounts.phone_call,
        data.channelCounts.web_booking,
        data.channelCounts.sms,
        data.channelCounts.manual,
        1
      )
    : 1
  const maxCalendarCount = data?.topCalendars[0]?.count ?? 1

  const showRateColor =
    !data || data.showRate === 0
      ? 'bg-gray-50 text-ink3 border-gray-200'
      : data.showRate >= 70
        ? 'bg-green-50 text-green-800 border-green-200'
        : data.showRate >= 50
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-rose-50 text-rose-800 border-rose-200'

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Appointment Report</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {loading ? '…' : `${data?.totalAppointments ?? 0} appointments in selected period`}
          </p>
        </div>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          className="px-3 py-2 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 text-ink2 bg-white"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="this_month">This month</option>
        </select>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : STATUS_CONFIG.map(({ key, label, border, num }) => (
              <div
                key={key}
                className={`bg-white rounded-lg border border-border-brand border-t-[3px] p-4 text-center ${border}`}
              >
                <p className={`text-2xl font-bold ${num}`}>
                  {data?.statusCounts[key as keyof typeof data.statusCounts] ?? 0}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-ink3 mt-1">{label}</p>
              </div>
            ))}
      </div>

      {/* Panels row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Channel Breakdown */}
        {loading ? (
          <SkeletonPanel />
        ) : (
          <div className="bg-white rounded-lg border border-border-brand p-5">
            <h2 className="text-sm font-semibold text-ink mb-4">Channel Breakdown</h2>
            <div className="space-y-3">
              {CHANNEL_CONFIG.map(({ key, label, icon, bar }) => {
                const count = data?.channelCounts[key] ?? 0
                const pct = channelTotal > 0 ? Math.round((count / channelTotal) * 100) : 0
                const widthPct = (count / maxChannelCount) * 100
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-28 text-xs text-ink3 flex items-center gap-1.5 shrink-0">
                      <span className="text-sm leading-none">{icon}</span>
                      {label}
                    </span>
                    <div className="flex-1 bg-gray-50 rounded-r h-7 overflow-hidden">
                      <div
                        className={`h-full rounded-r flex items-center gap-1.5 px-2 transition-all duration-700 ${bar}`}
                        style={{
                          width: barsVisible ? `${Math.max(widthPct, count > 0 ? 5 : 0)}%` : '0%',
                        }}
                      >
                        {count > 0 && (
                          <>
                            <span className="text-[10px] font-semibold text-white leading-none">
                              {count}
                            </span>
                            <span className="text-[10px] text-white/70 leading-none">{pct}%</span>
                          </>
                        )}
                      </div>
                    </div>
                    {count === 0 && <span className="text-xs text-ink4 ml-1">0</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top Calendars */}
        {loading ? (
          <SkeletonPanel />
        ) : (
          <div className="bg-white rounded-lg border border-border-brand p-5">
            <h2 className="text-sm font-semibold text-ink mb-4">Top Booked Calendars</h2>
            {!data?.topCalendars.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <span className="text-2xl text-gray-300 mb-2">📅</span>
                <p className="text-sm text-ink4">No calendar data yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.topCalendars.map((cal, i) => {
                  const widthPct = (cal.count / maxCalendarCount) * 100
                  return (
                    <div key={cal.calendarId} className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="w-28 text-xs text-ink2 font-medium truncate shrink-0">
                        {cal.calendarName}
                      </span>
                      <div className="flex-1 bg-gray-50 rounded-r h-6 overflow-hidden">
                        <div
                          className="h-full rounded-r bg-teal-400 transition-all duration-700"
                          style={{ width: barsVisible ? `${widthPct}%` : '0%' }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-ink2 w-6 text-right shrink-0">
                        {cal.count}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Show rate banner */}
      {!loading && data && (
        <div className={`rounded-lg border px-5 py-3 flex items-center gap-3 ${showRateColor}`}>
          <span className="text-sm font-semibold">Show Rate: {data.showRate}%</span>
          <span className="text-xs">
            — {data.statusCounts.completed} showed, {data.statusCounts.no_show} no-showed
          </span>
        </div>
      )}
    </div>
  )
}
