'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, dateFnsLocalizer, View, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { createClient } from '@supabase/supabase-js'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import AppointmentDrawer from './AppointmentDrawer'
import { ColumnsButton } from '@/components/ColumnsButton'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
import { Modal } from '@/components/ui/Modal'
import './calendar.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled'

interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  notes: string | null
  contacts: { full_name: string } | null
  staff_members: { id: string; name: string; color_hex: string } | null
  is_blocked?: boolean
  block_reason?: string | null
}

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  resource: Appointment
}

interface StaffMember {
  id: string
  name: string
  color_hex: string
}

interface Location {
  id: string
  name: string
}

// ── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: '#0d9488',
  confirmed: '#0d9488',
  completed: '#16a34a',
  no_show: '#f43f5e',
  canceled: '#9ca3af',
  rescheduled: '#f59e0b',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No Show',
  canceled: 'Canceled',
  rescheduled: 'Rescheduled',
}

// ── Time slots (15-min increments, 6 AM – 10 PM) ─────────────────────────────

const TIME_SLOTS: { value: string; label: string }[] = (() => {
  const slots: { value: string; label: string }[] = []
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
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

// ── Localizer ─────────────────────────────────────────────────────────────────

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { 'en-US': enUS },
})

// Initial scroll position for week/day time grids — open at 8 AM, not midnight
const SCROLL_TO_TIME = new Date(1970, 0, 1, 8, 0, 0)

// ── Supabase browser client ───────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ── Column visibility (G65) ───────────────────────────────────────────────────

const APPT_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'service', label: 'Service' },
  { key: 'staff', label: 'Staff' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'channel', label: 'Channel' },
]
const APPT_DEFAULTS = Object.fromEntries(APPT_COLUMNS.map((c) => [c.key, true]))

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tenantId: string
  initialAppointments: Appointment[]
  staff: StaffMember[]
  userRole: string
}

export default function AppointmentsCalendar({
  tenantId,
  initialAppointments,
  staff,
  userRole,
}: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments)
  const [view, setView] = useState<View>(Views.WEEK)
  // TODO(G65): When a list/table view is added to appointments, use colVisible to gate columns
  const { visible: colVisible, toggle: toggleCol } = useColumnVisibility(
    'nuatis_appointments_columns',
    APPT_DEFAULTS
  )
  const [date, setDate] = useState(new Date())
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [selectedBlockedAppt, setSelectedBlockedAppt] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const rangeRef = useRef<{ start: Date; end: Date } | null>(null)

  // Block Time modal
  const [showBlockModal, setShowBlockModal] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [blockCalendarId, setBlockCalendarId] = useState('')
  const [blockDate, setBlockDate] = useState('')
  const [blockStart, setBlockStart] = useState('09:00')
  const [blockEnd, setBlockEnd] = useState('10:00')
  const [blockReason, setBlockReason] = useState('')
  const [blockError, setBlockError] = useState<string | null>(null)
  const [blockSaving, setBlockSaving] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setView(Views.DAY)
    }
  }, [])

  // Fetch locations for calendar dropdown
  useEffect(() => {
    void (async () => {
      const supabase = getSupabase()
      const { data } = await supabase
        .from('locations')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .returns<Location[]>()
      if (data) setLocations(data)
    })()
  }, [tenantId])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const fetchRange = useCallback(
    async (start: Date, end: Date) => {
      setLoading(true)
      const supabase = getSupabase()
      const { data } = await supabase
        .from('appointments')
        .select(
          'id, title, start_time, end_time, status, notes, is_blocked, block_reason, contacts(full_name), staff_members!appointments_assigned_staff_id_fkey(id, name, color_hex)'
        )
        .eq('tenant_id', tenantId)
        .gte('start_time', start.toISOString())
        .lt('start_time', end.toISOString())
        .order('start_time', { ascending: true })
        .returns<Appointment[]>()
      setAppointments(data ?? [])
      setLoading(false)
    },
    [tenantId]
  )

  const handleRangeChange = useCallback(
    (range: Date[] | { start: Date; end: Date }) => {
      let start: Date
      let end: Date
      if (Array.isArray(range)) {
        start = range[0]!
        end = new Date(range[range.length - 1]!.getTime() + 86_400_000)
      } else {
        start = range.start
        end = range.end
      }
      rangeRef.current = { start, end }
      fetchRange(start, end)
    },
    [fetchRange]
  )

  const events = useMemo<CalendarEvent[]>(() => {
    return appointments
      .filter((a) => staffFilter === 'all' || a.staff_members?.id === staffFilter)
      .map((a) => ({
        id: a.id,
        title: a.is_blocked
          ? a.block_reason
            ? `🚫 ${a.block_reason}`
            : '🚫 Blocked'
          : (a.contacts?.full_name ?? a.title),
        start: new Date(a.start_time),
        end: new Date(a.end_time),
        resource: a,
      }))
  }, [appointments, staffFilter])

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    if (event.resource.is_blocked) {
      return {
        style: {
          backgroundColor: '#f59e0b',
          borderColor: '#d97706',
          color: '#fff',
          borderRadius: '4px',
          fontSize: '12px',
          padding: '2px 6px',
          opacity: 0.85,
        },
      }
    }
    const color = STATUS_COLOR[event.resource.status] ?? '#0d9488'
    return {
      style: {
        backgroundColor: color,
        borderColor: color,
        color: '#fff',
        borderRadius: '4px',
        fontSize: '12px',
        padding: '2px 6px',
      },
    }
  }, [])

  const handleSelectSlot = useCallback(({ start }: { start: Date }) => {
    const dateStr = format(start, 'yyyy-MM-dd')
    const timeStr = format(start, 'HH:mm')
    window.location.href = `/appointments/new?date=${dateStr}&start=${timeStr}`
  }, [])

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    if (event.resource.is_blocked) {
      setSelectedBlockedAppt(event.resource)
    } else {
      setSelectedAppt(event.resource)
    }
  }, [])

  async function submitBlock() {
    setBlockError(null)
    if (!blockDate || !blockStart || !blockEnd) {
      setBlockError('Date, start time, and end time are required')
      return
    }
    const startDt = new Date(`${blockDate}T${blockStart}:00`)
    const endDt = new Date(`${blockDate}T${blockEnd}:00`)
    if (endDt <= startDt) {
      setBlockError('End time must be after start time')
      return
    }
    setBlockSaving(true)
    try {
      const res = await fetch('/api/appointments/block', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: blockCalendarId || undefined,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
          reason: blockReason.trim() || undefined,
        }),
      })
      if (res.ok) {
        setShowBlockModal(false)
        setBlockCalendarId('')
        setBlockDate('')
        setBlockStart('09:00')
        setBlockEnd('10:00')
        setBlockReason('')
        setToast('Time blocked successfully')
        if (rangeRef.current) {
          void fetchRange(rangeRef.current.start, rangeRef.current.end)
        }
      } else {
        const body = (await res.json()) as { error?: string }
        setBlockError(body.error ?? 'Failed to block time')
      }
    } finally {
      setBlockSaving(false)
    }
  }

  async function deleteBlocked(id: string) {
    setSelectedBlockedAppt(null)
    setAppointments((prev) => prev.filter((a) => a.id !== id))
    await fetch(`/api/appointments/${id}`, { method: 'DELETE', credentials: 'include' })
  }

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-ink">Appointments</h1>
        <div className="flex items-center gap-3">
          {staff.length > 0 && (
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="text-sm border border-border-brand rounded-lg px-3 py-2 bg-white text-ink2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All Staff</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              setBlockError(null)
              setShowBlockModal(true)
            }}
            className="flex items-center gap-2 px-4 py-2 border border-border-brand text-sm font-medium text-ink2 rounded-lg hover:bg-bg2 transition-colors"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7.5" cy="7.5" r="6" />
              <line x1="3.2" y1="3.2" x2="11.8" y2="11.8" />
            </svg>
            Block Time
          </button>
          <ColumnsButton columns={APPT_COLUMNS} visible={colVisible} onChange={toggleCol} />
          <a
            href="/appointments/new"
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            New Appointment
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-4">
        {(Object.entries(STATUS_COLOR) as [AppointmentStatus, string][]).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-ink3">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-ink3">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" />
          Blocked
        </span>
      </div>

      <div
        className={`rbc-wrapper relative bg-white rounded-xl border border-border-brand overflow-hidden${
          loading ? ' opacity-60 pointer-events-none' : ''
        }`}
      >
        <Calendar
          localizer={localizer}
          events={events}
          view={view}
          date={date}
          onView={setView}
          onNavigate={setDate}
          onRangeChange={handleRangeChange}
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          selectable
          eventPropGetter={eventPropGetter}
          style={{ height: 680 }}
          scrollToTime={SCROLL_TO_TIME}
          popup
        />
        {view === Views.WEEK && !loading && events.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-ink4">Click any time slot to add an appointment</p>
          </div>
        )}
      </div>

      {selectedAppt && (
        <AppointmentDrawer
          appt={selectedAppt}
          userRole={userRole}
          onClose={() => setSelectedAppt(null)}
          onUpdated={(updated) => {
            setSelectedAppt(updated)
            setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
          }}
          onDeleted={() => {
            setAppointments((prev) => prev.filter((a) => a.id !== selectedAppt.id))
            setSelectedAppt(null)
          }}
        />
      )}

      {/* Blocked slot panel */}
      {selectedBlockedAppt && (
        <Modal
          onClose={() => setSelectedBlockedAppt(null)}
          title={selectedBlockedAppt.block_reason ?? 'Blocked time'}
          maxWidth="xs"
          footer={
            <Button
              onClick={() => void deleteBlocked(selectedBlockedAppt.id)}
              variant="outlined"
              color="error"
              fullWidth
            >
              Remove Block
            </Button>
          }
        >
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
            Blocked
          </span>
          <p className="text-xs text-ink4 mt-3">
            {new Date(selectedBlockedAppt.start_time).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            {' · '}
            {new Date(selectedBlockedAppt.start_time).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
            {' – '}
            {new Date(selectedBlockedAppt.end_time).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </Modal>
      )}

      {/* Block Time modal */}
      {showBlockModal && (
        <Modal
          onClose={() => setShowBlockModal(false)}
          title="Block Off Time"
          footer={
            <>
              <Button onClick={() => setShowBlockModal(false)} variant="text" color="inherit">
                Cancel
              </Button>
              <Button onClick={() => void submitBlock()} disabled={blockSaving} variant="contained">
                {blockSaving ? 'Blocking…' : 'Block Time'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {locations.length > 0 && (
              <TextField
                select
                label="Calendar (optional)"
                value={blockCalendarId}
                onChange={(e) => setBlockCalendarId(e.target.value)}
                fullWidth
                size="small"
              >
                <MenuItem value="">Any calendar</MenuItem>
                {locations.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              label="Date"
              type="date"
              value={blockDate}
              onChange={(e) => setBlockDate(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />

            <div className="grid grid-cols-2 gap-3">
              <TextField
                select
                label="Start Time"
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
                fullWidth
                size="small"
              >
                {TIME_SLOTS.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="End Time"
                value={blockEnd}
                onChange={(e) => setBlockEnd(e.target.value)}
                fullWidth
                size="small"
              >
                {TIME_SLOTS.map((s) => (
                  <MenuItem key={s.value} value={s.value}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            </div>

            <TextField
              label="Reason (optional)"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Lunch / Meeting / Vacation"
              fullWidth
              size="small"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitBlock()
              }}
            />

            {blockError && <p className="text-xs text-red-600">{blockError}</p>}
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-ink text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
