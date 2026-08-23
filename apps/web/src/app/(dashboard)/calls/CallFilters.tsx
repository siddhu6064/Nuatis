'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'

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
      <TextField
        select
        value={outcome ?? ''}
        onChange={(e) => router.push(buildUrl({ outcome: e.target.value || null }))}
        size="small"
        slotProps={{ select: { displayEmpty: true } }}
      >
        {OUTCOMES.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        type="date"
        value={fromDate ?? ''}
        onChange={(e) => router.push(buildUrl({ from_date: e.target.value || null }))}
        placeholder="From date"
        size="small"
      />

      <TextField
        type="date"
        value={toDate ?? ''}
        onChange={(e) => router.push(buildUrl({ to_date: e.target.value || null }))}
        placeholder="To date"
        size="small"
      />

      {hasFilters && (
        <Button onClick={() => router.push('/calls')} size="small">
          Clear filters
        </Button>
      )}
    </div>
  )
}
