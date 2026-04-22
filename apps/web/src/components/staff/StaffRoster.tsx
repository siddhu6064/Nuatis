'use client'

import { useState, useEffect, useCallback } from 'react'
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
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setShowAll(false)}
            className={`px-3 py-1.5 rounded-lg ${
              !showAll ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setShowAll(true)}
            className={`px-3 py-1.5 rounded-lg ${
              showAll ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            All
          </button>
        </div>
        <button
          onClick={() => setSlideOver({ open: true })}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Add Staff Member
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : members.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-gray-400">No team members yet.</p>
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
            <button
              key={m.id}
              onClick={() => setSlideOver({ open: true, member: m })}
              className={`text-left bg-white rounded-xl border border-gray-100 p-5 hover:border-gray-200 transition-colors ${
                !m.is_active ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <span
                  className="inline-block w-3 h-3 rounded-full mt-1 shrink-0"
                  style={{ backgroundColor: m.color_hex }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{m.name}</p>
                  <p className="text-sm text-gray-500 truncate">{m.role}</p>
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleActive(m)
                  }}
                  role="switch"
                  aria-checked={m.is_active}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                    m.is_active ? 'bg-teal-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      m.is_active ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </div>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {m.email && <p className="truncate">{m.email}</p>}
                {m.phone && <p className="truncate">{m.phone}</p>}
                <p className="text-gray-400 pt-1">{summarizeAvailability(m.availability)}</p>
              </div>
            </button>
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
