'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, dateFnsLocalizer, View, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { createClient } from '@supabase/supabase-js'
import AppointmentDrawer from './AppointmentDrawer'
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
  contacts: { full_name: string } | null
  staff_members: { id: string; name: string; color_hex: string } | null
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

// ── Localizer ─────────────────────────────────────────────────────────────────

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales: { 'en-US': enUS },
})

// ── Supabase browser client ───────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tenantId: string
  initialAppointments: Appointment[]
  staff: StaffMember[]
}

export default function AppointmentsCalendar({ tenantId, initialAppointments, staff }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments)
  const [view, setView] = useState<View>(Views.WEEK)
  const [date, setDate] = useState(new Date())
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(false)
  const rangeRef = useRef<{ start: Date; end: Date } | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setView(Views.DAY)
    }
  }, [])

  const fetchRange = useCallback(
    async (start: Date, end: Date) => {
      setLoading(true)
      const supabase = getSupabase()
      const { data } = await supabase
        .from('appointments')
        .select(
          'id, title, start_time, end_time, status, contacts(full_name), staff_members!appointments_assigned_staff_id_fkey(id, name, color_hex)'
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
        title: a.contacts?.full_name ?? a.title,
        start: new Date(a.start_time),
        end: new Date(a.end_time),
        resource: a,
      }))
  }, [appointments, staffFilter])

  const eventPropGetter = useCallback((event: CalendarEvent) => {
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
    setSelectedAppt(event.resource)
  }, [])

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Appointments</h1>
        <div className="flex items-center gap-3">
          {staff.length > 0 && (
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All Staff</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
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
          <span key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      <div
        className={`rbc-wrapper bg-white rounded-xl border border-gray-100 overflow-hidden${
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
          popup
        />
      </div>

      {selectedAppt && (
        <AppointmentDrawer appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  )
}
