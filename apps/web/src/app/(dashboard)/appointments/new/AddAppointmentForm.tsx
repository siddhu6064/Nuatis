'use client'

import { useState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { createAppointment } from './actions'

interface Service {
  id: string
  name: string
  duration_minutes: number | null
}

interface Contact {
  id: string
  full_name: string
}

interface StaffOption {
  id: string
  name: string
  color_hex: string
}

interface Props {
  contacts: Contact[]
  staff: StaffOption[]
  initialDate?: string
  initialStartTime?: string
}

const DURATIONS = [15, 30, 45, 60, 90]

function addMinutesToTime(time: string, minutes: number): string {
  if (!time) return ''
  const parts = time.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (isNaN(h) || isNaN(m)) return ''
  const total = h * 60 + m + minutes
  const eh = Math.floor(total / 60) % 24
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="contained">
      {pending ? 'Saving…' : 'Save Appointment'}
    </Button>
  )
}

export default function AddAppointmentForm({
  contacts,
  staff,
  initialDate,
  initialStartTime,
}: Props) {
  const [services, setServices] = useState<Service[]>([])
  const [serviceId, setServiceId] = useState('')
  const [titleValue, setTitleValue] = useState('')
  const [startTime, setStartTime] = useState(initialStartTime ?? '')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [durationFlash, setDurationFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const endTime = addMinutesToTime(startTime, durationMinutes)

  useEffect(() => {
    fetch('/api/services')
      .then((r) => (r.ok ? r.json() : { services: [] }))
      .then((d: { services: Service[] }) => setServices(d.services ?? []))
      .catch(() => {})
  }, [])

  function handleServiceChange(id: string) {
    setServiceId(id)
    const svc = services.find((s) => s.id === id)
    if (!svc) return

    if (!titleValue.trim()) setTitleValue(svc.name)

    if (svc.duration_minutes) {
      setDurationMinutes(svc.duration_minutes)
      setDurationFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setDurationFlash(false), 1500)
    }
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <form action={createAppointment} className="space-y-4">
          {/* Service select — shown only when CPQ services exist */}
          {services.length > 0 && (
            <TextField
              select
              label="Service"
              name="service_id"
              value={serviceId}
              onChange={(e) => handleServiceChange(e.target.value)}
              fullWidth
              size="small"
            >
              <MenuItem value="">No specific service</MenuItem>
              {services.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                  {s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Title"
            required
            name="title"
            autoFocus={services.length === 0}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            placeholder="e.g. Checkup, Consultation"
            fullWidth
            size="small"
          />

          <TextField
            select
            label="Contact"
            name="contact_id"
            defaultValue=""
            fullWidth
            size="small"
          >
            <MenuItem value="">— None —</MenuItem>
            {contacts.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.full_name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Date"
            required
            name="date"
            type="date"
            defaultValue={initialDate}
            fullWidth
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Start Time"
              required
              name="start_time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              label="Duration"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
              fullWidth
              size="small"
              sx={
                durationFlash
                  ? {
                      transition: 'box-shadow 0.3s',
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main' },
                    }
                  : undefined
              }
            >
              {DURATIONS.map((d) => (
                <MenuItem key={d} value={d}>
                  {d} min
                </MenuItem>
              ))}
            </TextField>
          </div>

          {startTime && endTime && <p className="text-xs text-ink4 -mt-2">Ends at {endTime}</p>}

          {/* Computed end_time for server action */}
          <input type="hidden" name="end_time" value={endTime} />

          {staff.length > 0 && (
            <TextField
              select
              label="Assigned staff"
              name="assigned_staff_id"
              defaultValue=""
              fullWidth
              size="small"
            >
              <MenuItem value="">Any available</MenuItem>
              {staff.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Notes"
            name="notes"
            multiline
            rows={3}
            placeholder="Optional notes…"
            fullWidth
            size="small"
          />

          <div className="flex items-center gap-3 pt-2">
            <SubmitButton />
            <Button component={Link} href="/appointments" color="inherit">
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
