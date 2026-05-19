'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayHours {
  open: string
  close: string
  enabled: boolean
}

interface HoursMap {
  mon: DayHours
  tue: DayHours
  wed: DayHours
  thu: DayHours
  fri: DayHours
  sat: DayHours
  sun: DayHours
}

interface Schedule {
  id: string
  name: string
  timezone: string
  hours: HoursMap
  applied_count: number
  applied_location_ids: string[]
}

interface Location {
  id: string
  name: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS: { key: keyof HoursMap; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

const TIME_SLOTS: { value: string; label: string }[] = (() => {
  const slots: { value: string; label: string }[] = []
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 22 && m > 0) break
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h
      const ampm = h < 12 ? 'AM' : 'PM'
      const label = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      slots.push({ value, label })
    }
  }
  return slots
})()

const DEFAULT_HOURS: HoursMap = {
  mon: { open: '09:00', close: '17:00', enabled: true },
  tue: { open: '09:00', close: '17:00', enabled: true },
  wed: { open: '09:00', close: '17:00', enabled: true },
  thu: { open: '09:00', close: '17:00', enabled: true },
  fri: { open: '09:00', close: '17:00', enabled: true },
  sat: { open: '09:00', close: '17:00', enabled: false },
  sun: { open: '09:00', close: '17:00', enabled: false },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AvailabilityPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Editor state
  const [editName, setEditName] = useState('')
  const [editTimezone, setEditTimezone] = useState('America/Chicago')
  const [editHours, setEditHours] = useState<HoursMap>(DEFAULT_HOURS)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Apply state
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const [schedRes, locRes] = await Promise.all([
      fetch('/api/availability-schedules', { credentials: 'include' }),
      fetch('/api/locations', { credentials: 'include' }),
    ])
    if (schedRes.ok) {
      const data = (await schedRes.json()) as { schedules: Schedule[] }
      setSchedules(data.schedules)
    }
    if (locRes.ok) {
      const data = (await locRes.json()) as { locations: Location[] }
      setLocations(data.locations)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  function selectSchedule(s: Schedule) {
    setSelectedId(s.id)
    setEditName(s.name)
    setEditTimezone(s.timezone ?? 'America/Chicago')
    setEditHours(s.hours ?? DEFAULT_HOURS)
    setSelectedLocationIds(new Set(s.applied_location_ids))
    setSaveSuccess(false)
    setApplyMsg(null)
  }

  async function createSchedule() {
    const res = await fetch('/api/availability-schedules', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Schedule',
        timezone: 'America/Chicago',
        hours: DEFAULT_HOURS,
      }),
    })
    if (res.ok) {
      const data = (await res.json()) as { schedule: Schedule }
      setSchedules((prev) => [...prev, data.schedule])
      selectSchedule(data.schedule)
    }
  }

  async function saveSchedule() {
    if (!selectedId) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/availability-schedules/${selectedId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, timezone: editTimezone, hours: editHours }),
      })
      if (res.ok) {
        const data = (await res.json()) as { schedule: Schedule }
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === selectedId
              ? {
                  ...data.schedule,
                  applied_count: s.applied_count,
                  applied_location_ids: s.applied_location_ids,
                }
              : s
          )
        )
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/availability-schedules/${id}`, { method: 'DELETE', credentials: 'include' })
    setSchedules((prev) => prev.filter((s) => s.id !== id))
    if (selectedId === id) {
      setSelectedId(null)
    }
  }

  async function applySchedule() {
    if (!selectedId) return
    setApplying(true)
    setApplyMsg(null)
    try {
      const calendarIds = [...selectedLocationIds]
      const res = await fetch(`/api/availability-schedules/${selectedId}/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarIds }),
      })
      if (res.ok) {
        const data = (await res.json()) as { applied: number }
        setApplyMsg(`Applied to ${data.applied} calendar${data.applied !== 1 ? 's' : ''}`)
        // Refresh to update counts
        await fetchAll()
        setTimeout(() => setApplyMsg(null), 3000)
      }
    } finally {
      setApplying(false)
    }
  }

  function toggleDay(key: keyof HoursMap) {
    setEditHours((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }))
  }

  function setDayField(key: keyof HoursMap, field: 'open' | 'close', value: string) {
    setEditHours((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }))
  }

  function toggleLocation(id: string) {
    setSelectedLocationIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedSchedule = schedules.find((s) => s.id === selectedId) ?? null

  if (loading) {
    return <div className="px-8 py-8 text-sm text-ink4">Loading...</div>
  }

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Availability Schedules</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Define reusable weekly hour templates and apply them to calendars.
          </p>
        </div>
        <button
          onClick={() => void createSchedule()}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Schedule
        </button>
      </div>

      {/* Body: list + editor */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left: schedule list */}
        <div className="w-72 shrink-0 flex flex-col gap-1 overflow-y-auto">
          {schedules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-brand px-4 py-8 text-center">
              <p className="text-xs text-ink4">No schedules yet.</p>
              <p className="text-xs text-ink4 mt-1">Click &ldquo;New Schedule&rdquo; to start.</p>
            </div>
          ) : (
            schedules.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSchedule(s)}
                className={`flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedId === s.id
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-border-brand bg-white hover:bg-bg2'
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${selectedId === s.id ? 'text-teal-700' : 'text-ink'}`}
                  >
                    {s.name}
                  </p>
                  <p className="text-xs text-ink4 mt-0.5">
                    {s.applied_count} calendar{s.applied_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteSchedule(s.id)
                  }}
                  className="ml-2 text-ink4 hover:text-red-500 text-base leading-none shrink-0"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Right: editor */}
        {selectedSchedule ? (
          <div className="flex-1 overflow-y-auto">
            <div className="bg-white rounded-xl border border-border-brand p-6 space-y-6">
              {/* Name + timezone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-ink3 mb-1">Schedule Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink3 mb-1">Timezone</label>
                  <select
                    value={editTimezone}
                    onChange={(e) => setEditTimezone(e.target.value)}
                    className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 bg-white text-ink2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Weekly hours grid */}
              <div>
                <h3 className="text-sm font-semibold text-ink mb-3">Weekly Hours</h3>
                <div className="space-y-2">
                  {DAYS.map(({ key, label }) => {
                    const day = editHours[key]
                    return (
                      <div key={key} className="flex items-center gap-3">
                        {/* Toggle */}
                        <button
                          type="button"
                          onClick={() => toggleDay(key)}
                          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                            day.enabled ? 'bg-teal-500' : 'bg-bg3'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              day.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>

                        {/* Day label */}
                        <span className="text-sm text-ink2 w-24 shrink-0">{label}</span>

                        {day.enabled ? (
                          <>
                            <select
                              value={day.open}
                              onChange={(e) => setDayField(key, 'open', e.target.value)}
                              className="text-xs border border-border-brand rounded px-2 py-1.5 bg-white text-ink2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            >
                              {TIME_SLOTS.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            <span className="text-ink4 text-xs">—</span>
                            <select
                              value={day.close}
                              onChange={(e) => setDayField(key, 'close', e.target.value)}
                              className="text-xs border border-border-brand rounded px-2 py-1.5 bg-white text-ink2 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            >
                              {TIME_SLOTS.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="text-xs text-ink4 italic">Closed</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Save button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void saveSchedule()}
                  disabled={saving || !editName.trim()}
                  className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Schedule'}
                </button>
                {saveSuccess && <span className="text-xs text-teal-600 font-medium">Saved!</span>}
              </div>

              {/* Apply to Calendars */}
              {locations.length > 0 && (
                <div className="border-t border-border-brand pt-5">
                  <h3 className="text-sm font-semibold text-ink mb-1">Apply to Calendars</h3>
                  <p className="text-xs text-ink4 mb-3">
                    Select which calendars use this schedule.
                  </p>
                  <div className="space-y-2 mb-4">
                    {locations.map((loc) => (
                      <label key={loc.id} className="flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLocationIds.has(loc.id)}
                          onChange={() => toggleLocation(loc.id)}
                          className="w-4 h-4 rounded border-border-brand text-teal-600 focus:ring-teal-500"
                        />
                        <span className="text-sm text-ink2">{loc.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void applySchedule()}
                      disabled={applying}
                      className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                    >
                      {applying ? 'Applying...' : 'Apply to Selected'}
                    </button>
                    {applyMsg && (
                      <span className="text-xs text-teal-600 font-medium">{applyMsg}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-ink4">Select a schedule to edit</p>
              <p className="text-xs text-ink4 mt-1">
                or click &ldquo;New Schedule&rdquo; to create one.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
