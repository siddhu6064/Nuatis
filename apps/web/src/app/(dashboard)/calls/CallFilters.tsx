'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

const OUTCOMES = [
  { value: '', label: 'All outcomes' },
  { value: 'booking_made', label: 'Booking Made' },
  { value: 'inquiry_answered', label: 'Inquiry Answered' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'general', label: 'General' },
]

interface Props {
  outcome: string | null
  fromDate: string | null
  toDate: string | null
  hasFilters: boolean
}

export default function CallFilters({ outcome, fromDate, toDate, hasFilters }: Props) {
  const router = useRouter()

  const buildUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams()
      const merged = {
        outcome: updates.outcome !== undefined ? updates.outcome : outcome,
        from_date: updates.from_date !== undefined ? updates.from_date : fromDate,
        to_date: updates.to_date !== undefined ? updates.to_date : toDate,
      }
      if (merged.outcome) params.set('outcome', merged.outcome)
      if (merged.from_date) params.set('from_date', merged.from_date)
      if (merged.to_date) params.set('to_date', merged.to_date)
      const qs = params.toString()
      return qs ? `/calls?${qs}` : '/calls'
    },
    [outcome, fromDate, toDate]
  )

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <select
        value={outcome ?? ''}
        onChange={(e) => router.push(buildUrl({ outcome: e.target.value || null }))}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      >
        {OUTCOMES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={fromDate ?? ''}
        onChange={(e) => router.push(buildUrl({ from_date: e.target.value || null }))}
        placeholder="From date"
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />

      <input
        type="date"
        value={toDate ?? ''}
        onChange={(e) => router.push(buildUrl({ to_date: e.target.value || null }))}
        placeholder="To date"
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />

      {hasFilters && (
        <button
          onClick={() => router.push('/calls')}
          className="text-xs text-teal-600 font-medium hover:text-teal-700 transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
