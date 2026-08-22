'use client'

import { useState, useEffect, useCallback } from 'react'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import StaffSlideOver from './StaffSlideOver'
import { DAY_KEYS, DAY_LABEL, type Availability, type DayKey, type StaffMember } from './types'

function summarizeAvailability(av: Availability | null | undefined): string {
  if (!av) return 'No availability set'
  const enabled = DAY_KEYS.filter((d) => av[d]?.enabled)
  if (enabled.length === 0) return 'No availability set'

  // Group consecutive days that share the same start+end
  const groups: Array<{ days: DayKey[]; start: string; end: string }> = []
  for (const d of enabled) {
    const cur = av[d]!
    const start = cur.start ?? '09:00'
    const end = cur.end ?? '17:00'
    const last = groups[groups.length - 1]
    const lastDayIdx = last ? DAY_KEYS.indexOf(last.days[last.days.length - 1]!) : -1
    const thisIdx = DAY_KEYS.indexOf(d)
    if (last && last.start === start && last.end === end && thisIdx === lastDayIdx + 1) {
      last.days.push(d)
    } else {
      groups.push({ days: [d], start, end })
    }
  }

  return groups
    .map((g) => {
      const label =
        g.days.length === 1
          ? DAY_LABEL[g.days[0]!]
          : `${DAY_LABEL[g.days[0]!]}–${DAY_LABEL[g.days[g.days.length - 1]!]}`
      return `${label} ${g.start}–${g.end}`
    })
    .join(', ')
}

export default function StaffRoster() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [slideOver, setSlideOver] = useState<{ open: boolean; member?: StaffMember }>({
    open: false,
  })
  const [toast, setToast] = useState<string | null>(null)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const q = showAll ? '?active=all' : ''
      const res = await fetch(`/api/staff${q}`)
      if (res.ok) {
        const data = (await res.json()) as { data: StaffMember[] }
        setMembers(data.data)
      }
    } finally {
      setLoading(false)
    }
  }, [showAll])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const toggleActive = async (m: StaffMember) => {
    // Optimistic flip
    setMembers((prev) => prev.map((p) => (p.id === m.id ? { ...p, is_active: !m.is_active } : p)))
    const res = await fetch(`/api/staff/${m.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !m.is_active }),
    })
    if (!res.ok) {
      // Revert
      setMembers((prev) => prev.map((p) => (p.id === m.id ? { ...p, is_active: m.is_active } : p)))
      setToast('Failed to toggle active state')
    }
  }

  const onSaved = (saved: StaffMember) => {
    setMembers((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setToast(slideOver.member ? 'Member updated' : 'Member added')
    setSlideOver({ open: false })
  }

  return (
    <div>
      {/* Filter + Add */}
      <div className="flex items-center justify-between mb-4">
        <ToggleButtonGroup
          value={showAll ? 'all' : 'active'}
          exclusive
          onChange={(_e, v: string | null) => v !== null && setShowAll(v === 'all')}
          size="small"
        >
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
        <Button onClick={() => setSlideOver({ open: true })} variant="contained">
          + Add Staff Member
        </Button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-ink4">Loading...</div>
      ) : members.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-ink4">No team members yet.</p>
          <button
            onClick={() => setSlideOver({ open: true })}
            className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-medium"
          >
            Add your first team member &rarr;
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setSlideOver({ open: true, member: m })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSlideOver({ open: true, member: m })
                }
              }}
              className={`text-left bg-white rounded-xl border border-border-brand p-5 hover:border-border-brand transition-colors cursor-pointer ${
                !m.is_active ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <span
                  className="inline-block w-3 h-3 rounded-full mt-1 shrink-0"
                  style={{ backgroundColor: m.color_hex }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink truncate">{m.name}</p>
                  <p className="text-sm text-ink3 truncate">{m.role}</p>
                </div>
                <Switch
                  size="small"
                  checked={m.is_active}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => void toggleActive(m)}
                  slotProps={{ input: { 'aria-label': `${m.name} active` } }}
                />
              </div>
              <div className="space-y-1 text-xs text-ink3">
                {m.email && <p className="truncate">{m.email}</p>}
                {m.phone && <p className="truncate">{m.phone}</p>}
                <p className="text-ink4 pt-1">{summarizeAvailability(m.availability)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {slideOver.open && (
        <StaffSlideOver
          open={slideOver.open}
          onClose={() => setSlideOver({ open: false })}
          member={slideOver.member}
          onSaved={onSaved}
        />
      )}

      {toast && (
        <div className="fixed top-4 right-4 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
