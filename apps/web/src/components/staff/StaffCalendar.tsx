'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import ShiftSlideOver from './ShiftSlideOver'
import type { DayKey, Shift, StaffMember } from './types'

function startOfWeek(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  const dow = copy.getDay() // 0=Sun .. 6=Sat
  const delta = (dow + 6) % 7 // days back to Monday
  copy.setDate(copy.getDate() - delta)
  return copy
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const period = h >= 12 ? 'pm' : 'am'
  const hh = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hh}${period}` : `${hh}:${String(m).padStart(2, '0')}${period}`
}

const DAY_COLS: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

export default function StaffCalendar() {
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date()))
  const [showWeekends, setShowWeekends] = useState(true)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [slide, setSlide] = useState<
    | {
        open: true
        mode: 'add'
        staffId: string
        staffName: string
        date: string
        defaultStart: string
        defaultEnd: string
      }
    | { open: true; mode: 'edit'; shift: Shift }
    | { open: false }
  >({ open: false })

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])
  const dayColumns = showWeekends ? DAY_COLS : DAY_COLS.slice(0, 5)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const start = toISODate(weekStart)
      const end = toISODate(weekEnd)
      const [staffRes, shiftsRes] = await Promise.all([
        fetch('/api/staff'),
        fetch(`/api/staff/shifts?start_date=${start}&end_date=${end}`),
      ])
      if (staffRes.ok) {
        const d = (await staffRes.json()) as { data: StaffMember[] }
        setStaff(d.data)
      }
      if (shiftsRes.ok) {
        const d = (await shiftsRes.json()) as { data: Shift[] }
        setShifts(d.data)
      }
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const shiftsByStaffAndDate = useMemo(() => {
    const map = new Map<string, Shift[]>()
    for (const s of shifts) {
      const k = `${s.staff_id}|${s.date}`
      const list = map.get(k) ?? []
      list.push(s)
      map.set(k, list)
    }
    return map
  }, [shifts])

  const goPrev = () => setWeekStart((w) => addDays(w, -7))
  const goNext = () => setWeekStart((w) => addDays(w, 7))
  const goToday = () => setWeekStart(startOfWeek(new Date()))

  const openAdd = (m: StaffMember, colKey: DayKey, colIdx: number) => {
    const date = toISODate(addDays(weekStart, colIdx))
    const avail = m.availability?.[colKey]
    const defaultStart = avail?.enabled ? (avail.start ?? '09:00') : '09:00'
    const defaultEnd = avail?.enabled ? (avail.end ?? '17:00') : '17:00'
    setSlide({
      open: true,
      mode: 'add',
      staffId: m.id,
      staffName: m.name,
      date,
      defaultStart,
      defaultEnd,
    })
  }

  const openEdit = (s: Shift) => setSlide({ open: true, mode: 'edit', shift: s })

  const headerLabel = `${weekStart.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} — ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div>
      {/* Nav */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            ‹ Prev
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            This Week
          </button>
          <button
            onClick={goNext}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Next ›
          </button>
          <span className="ml-3 text-sm font-medium text-gray-700">{headerLabel}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showWeekends}
            onChange={(e) => setShowWeekends(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show weekends
        </label>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
      ) : staff.filter((m) => m.is_active).length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-400">
          No active staff. Add team members in the Roster tab to schedule shifts.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <div
            className="grid"
            style={{
              gridTemplateColumns: `140px repeat(${dayColumns.length}, minmax(120px, 1fr))`,
            }}
          >
            {/* Header row */}
            <div className="px-3 py-2 border-b border-gray-100 text-xs font-medium text-gray-400">
              Staff
            </div>
            {dayColumns.map((c, i) => {
              const date = addDays(weekStart, i)
              return (
                <div
                  key={c.key}
                  className="px-3 py-2 border-b border-l border-gray-100 text-xs font-medium text-gray-500"
                >
                  <div>{c.label}</div>
                  <div className="text-[10px] text-gray-400">
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              )
            })}

            {/* Staff rows */}
            {staff
              .filter((m) => m.is_active)
              .map((m) => (
                <div key={m.id} className="contents">
                  <div className="px-3 py-3 border-b border-gray-50 flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: m.color_hex }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{m.role}</p>
                    </div>
                  </div>
                  {dayColumns.map((c, i) => {
                    const dateIso = toISODate(addDays(weekStart, i))
                    const dayShifts = shiftsByStaffAndDate.get(`${m.id}|${dateIso}`) ?? []
                    return (
                      <div
                        key={c.key}
                        onClick={() => {
                          if (dayShifts.length === 0) openAdd(m, c.key, i)
                        }}
                        className="px-2 py-2 border-b border-l border-gray-50 min-h-[64px] hover:bg-gray-50/50 cursor-pointer"
                      >
                        {dayShifts.map((s) => (
                          <button
                            key={s.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              openEdit(s)
                            }}
                            className="block w-full text-left text-xs rounded px-2 py-1 mb-1 truncate"
                            style={{
                              backgroundColor: `${m.color_hex}33`,
                              borderLeft: `3px solid ${m.color_hex}`,
                            }}
                          >
                            {formatTime(s.start_time)}–{formatTime(s.end_time)}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
          </div>
        </div>
      )}

      {slide.open && (
        <ShiftSlideOver
          open={slide.open}
          onClose={() => setSlide({ open: false })}
          staffList={staff.filter((m) => m.is_active)}
          {...(slide.mode === 'edit'
            ? { shift: slide.shift }
            : {
                staffId: slide.staffId,
                staffName: slide.staffName,
                date: slide.date,
                defaultStart: slide.defaultStart,
                defaultEnd: slide.defaultEnd,
              })}
          onSaved={() => {
            void fetchAll()
          }}
          onDeleted={() => {
            void fetchAll()
          }}
        />
      )}
    </div>
  )
}
