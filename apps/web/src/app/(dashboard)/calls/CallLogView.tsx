'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

interface VoiceSession {
  id: string
  caller_phone: string | null
  caller_name: string | null
  contact_id: string | null
  contacts: { full_name: string } | null
  started_at: string
  duration_seconds: number | null
  first_response_ms: number | null
  outcome: string | null
  language_detected: string | null
  call_quality_mos: number | null
  booked_appointment: boolean
  escalated: boolean
}

const OUTCOME_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  booking_made: { label: 'Booking Made', bg: 'bg-green-50', text: 'text-green-700' },
  inquiry_answered: { label: 'Inquiry', bg: 'bg-blue-50', text: 'text-blue-700' },
  escalated: { label: 'Escalated', bg: 'bg-amber-50', text: 'text-amber-700' },
  abandoned: { label: 'Abandoned', bg: 'bg-red-50', text: 'text-red-600' },
  general: { label: 'General', bg: 'bg-gray-100', text: 'text-gray-600' },
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Unknown'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '--'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

type BucketKey = 'current_week' | 'last_week' | 'last_month' | 'older'

interface ContactGroup {
  groupKey: string
  displayName: string
  phone: string | null
  calls: VoiceSession[]
  lastCallAt: string
}

interface Bucket {
  key: BucketKey
  label: string
  groups: ContactGroup[]
}

function getBucketBoundaries() {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun
  const daysToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const currentWeekStart = new Date(now)
  currentWeekStart.setDate(now.getDate() - daysToMon)
  currentWeekStart.setHours(0, 0, 0, 0)

  const lastWeekStart = new Date(currentWeekStart)
  lastWeekStart.setDate(currentWeekStart.getDate() - 7)

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  return { currentWeekStart, lastWeekStart, lastMonthStart }
}

function assignBucket(
  startedAt: string,
  boundaries: ReturnType<typeof getBucketBoundaries>
): BucketKey {
  const t = new Date(startedAt).getTime()
  if (t >= boundaries.currentWeekStart.getTime()) return 'current_week'
  if (t >= boundaries.lastWeekStart.getTime()) return 'last_week'
  if (t >= boundaries.lastMonthStart.getTime()) return 'last_month'
  return 'older'
}

function bucketAndGroup(calls: VoiceSession[]): Bucket[] {
  const boundaries = getBucketBoundaries()

  const bucketCalls: Record<BucketKey, VoiceSession[]> = {
    current_week: [],
    last_week: [],
    last_month: [],
    older: [],
  }
  for (const call of calls) {
    bucketCalls[assignBucket(call.started_at, boundaries)].push(call)
  }

  const BUCKET_LABELS: Record<BucketKey, string> = {
    current_week: 'Current Week',
    last_week: 'Last Week',
    last_month: 'Last Month',
    older: 'Older',
  }

  return (['current_week', 'last_week', 'last_month', 'older'] as BucketKey[])
    .map((key) => {
      const groupMap = new Map<string, ContactGroup>()
      for (const call of bucketCalls[key]) {
        const groupKey = call.contact_id ?? call.caller_phone ?? 'unknown'
        const displayName =
          call.contacts?.full_name ?? call.caller_name ?? formatPhone(call.caller_phone)
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            groupKey,
            displayName,
            phone: call.caller_phone,
            calls: [],
            lastCallAt: call.started_at,
          })
        }
        const group = groupMap.get(groupKey)!
        group.calls.push(call)
        if (new Date(call.started_at) > new Date(group.lastCallAt)) {
          group.lastCallAt = call.started_at
        }
      }
      const groups = Array.from(groupMap.values()).sort(
        (a, b) => new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime()
      )
      return { key, label: BUCKET_LABELS[key], groups }
    })
    .filter((b) => b.groups.length > 0)
}

interface Props {
  calls: VoiceSession[]
  total: number
  hasFilters: boolean
}

export default function CallLogView({ calls, total, hasFilters }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const buckets = useMemo(() => bucketAndGroup(calls), [calls])

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (calls.length === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white flex flex-col items-center justify-center py-20 text-center">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
          <span className="text-gray-300 text-xl">◉</span>
        </div>
        <p className="text-sm font-medium text-gray-400">
          {hasFilters ? 'No calls match your filters' : 'No calls yet'}
        </p>
        <p className="text-xs text-gray-300 mt-1">
          {hasFilters
            ? 'Try adjusting your filters'
            : "Once Maya starts handling calls, they'll appear here"}
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">
        Showing {calls.length} of {total} calls
      </p>

      <div className="space-y-6">
        {buckets.map((bucket) => {
          const bucketTotal = bucket.groups.reduce((s, g) => s + g.calls.length, 0)
          return (
            <div key={bucket.key}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {bucket.label}
                </h2>
                <span className="text-xs text-gray-400">
                  · {bucketTotal} call{bucketTotal !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                {bucket.groups.map((group) => {
                  const expandKey = `${bucket.key}:${group.groupKey}`
                  const isOpen = expanded.has(expandKey)

                  const outcomeCounts = group.calls.reduce<Record<string, number>>((acc, c) => {
                    const o = c.outcome ?? 'general'
                    acc[o] = (acc[o] ?? 0) + 1
                    return acc
                  }, {})

                  return (
                    <div key={group.groupKey}>
                      <button
                        onClick={() => toggleGroup(expandKey)}
                        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                          <span className="text-teal-700 text-xs font-bold">
                            {group.displayName.charAt(0).toUpperCase()}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {group.displayName}
                          </p>
                          {group.phone && group.displayName !== formatPhone(group.phone) && (
                            <p className="text-xs text-gray-400 truncate">
                              {formatPhone(group.phone)}
                            </p>
                          )}
                        </div>

                        <span className="shrink-0 text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                          {group.calls.length} call{group.calls.length !== 1 ? 's' : ''}
                        </span>

                        <div className="hidden sm:flex items-center gap-1 shrink-0">
                          {Object.entries(outcomeCounts).map(([outcome, count]) => {
                            const badge = OUTCOME_BADGES[outcome] ?? OUTCOME_BADGES.general
                            return (
                              <span
                                key={outcome}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge!.bg} ${badge!.text}`}
                              >
                                {count > 1 ? `${count}× ` : ''}
                                {badge!.label}
                              </span>
                            )
                          })}
                        </div>

                        <span className="shrink-0 text-xs text-gray-400">
                          {new Date(group.lastCallAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>

                        <span
                          className={`shrink-0 text-gray-400 text-lg leading-none transition-transform duration-150 ${
                            isOpen ? 'rotate-90' : ''
                          }`}
                        >
                          ›
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-100 bg-gray-50/40">
                          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] text-[10px] font-medium text-gray-400 uppercase tracking-wide px-6 py-1.5 border-b border-gray-100">
                            <span>Date / Time</span>
                            <span className="w-28 text-center">Outcome</span>
                            <span className="w-14 text-right">Duration</span>
                            <span className="w-8 text-right">Lang</span>
                            <span className="w-14 text-right">Latency</span>
                            <span className="w-12 text-right">MOS</span>
                            <span className="w-6" />
                          </div>
                          {group.calls
                            .slice()
                            .sort(
                              (a, b) =>
                                new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
                            )
                            .map((call) => {
                              const badge =
                                OUTCOME_BADGES[call.outcome ?? 'general'] ?? OUTCOME_BADGES.general
                              return (
                                <Link
                                  key={call.id}
                                  href={`/calls/${call.id}`}
                                  className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] items-center px-6 py-2.5 hover:bg-gray-100/60 transition-colors"
                                >
                                  <span className="text-xs text-gray-500">
                                    {new Date(call.started_at).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}{' '}
                                    <span className="text-gray-400">
                                      {new Date(call.started_at).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true,
                                      })}
                                    </span>
                                  </span>
                                  <span
                                    className={`w-28 inline-flex justify-center items-center px-2 py-0.5 rounded text-xs font-medium ${badge!.bg} ${badge!.text}`}
                                  >
                                    {badge!.label}
                                  </span>
                                  <span className="w-14 text-right text-xs text-gray-500">
                                    {formatDuration(call.duration_seconds)}
                                  </span>
                                  <span className="w-8 text-right text-xs text-gray-400 uppercase">
                                    {call.language_detected ?? '--'}
                                  </span>
                                  <span className="w-14 text-right text-xs text-gray-400">
                                    {formatLatency(call.first_response_ms)}
                                  </span>
                                  <span className="w-12 text-right text-xs text-gray-400">
                                    {call.call_quality_mos != null
                                      ? Number(call.call_quality_mos).toFixed(2)
                                      : '--'}
                                  </span>
                                  <span className="w-6 text-right text-teal-500 text-sm">→</span>
                                </Link>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
