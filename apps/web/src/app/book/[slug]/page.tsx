'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

// ─── Types ───────────────────────────────────────────────────────────────────

interface IntakeField {
  id: string
  label: string
  type: 'text' | 'email' | 'phone' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox'
  required: boolean
  options?: string[]
}

interface IntakeForm {
  id: string
  name: string
  fields: IntakeField[]
}

interface Service {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  unit_price: number
  intakeForm: IntakeForm | null
}

interface BookingPage {
  tenantId: string
  businessName: string
  businessPhone: string | null
  accentColor: string
  confirmationMessage: string
  googleReviewUrl: string | null
  bufferMinutes: number
  advanceDays: number
  services: Service[]
}

interface ConfirmResponse {
  confirmationMessage: string
  bookingId: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h! >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h! > 12 ? h! - 12 : h!
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatPrice(cents: number): string {
  return `$${Number(cents).toFixed(2)}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function toYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  )
}

// ─── Step 1: Select Service ────────────────────────────────────────────────────

function StepSelectService({
  page,
  onSelect,
}: {
  page: BookingPage
  onSelect: (service: Service) => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Select a Service</h2>
      <p className="text-sm text-gray-500 mb-5">Choose the service you'd like to book</p>
      <div className="space-y-3">
        {page.services.map((service) => (
          <button
            key={service.id}
            onClick={() => onSelect(service)}
            className="w-full text-left rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:border-gray-300 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-medium text-gray-900">{service.name}</p>
                {service.description && (
                  <p className="text-sm text-gray-500 mt-1">{service.description}</p>
                )}
                <p className="text-sm text-gray-400 mt-2">{service.duration_minutes} min</p>
              </div>
              <p className="text-base font-semibold text-gray-900 shrink-0">
                {formatPrice(service.unit_price)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Step 2: Select Date & Time ────────────────────────────────────────────────

function CalendarGrid({
  advanceDays,
  accentColor,
  selectedDate,
  onSelectDate,
}: {
  advanceDays: number
  accentColor: string
  selectedDate: Date | null
  onSelectDate: (d: Date) => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + advanceDays)

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1)
      setViewMonth(11)
    } else setViewMonth((m) => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1)
      setViewMonth(0)
    } else setViewMonth((m) => m + 1)
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d))

  // Disable prev navigation if we're already at today's month
  const canGoPrev = viewYear > today.getFullYear() || viewMonth > today.getMonth()
  // Disable next if max date is within this month
  const maxYear = maxDate.getFullYear()
  const maxMonth = maxDate.getMonth()
  const canGoNext = viewYear < maxYear || (viewYear === maxYear && viewMonth < maxMonth)

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevMonth}
          disabled={!canGoPrev}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="w-5 h-5 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-800">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          disabled={!canGoNext}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="w-5 h-5 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map((label, i) => (
          <div key={i} className="text-center text-xs text-gray-400 font-medium py-1">
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />

          date.setHours(0, 0, 0, 0)
          const isPast = date < today
          const isBeyond = date > maxDate
          const isDisabled = isPast || isBeyond
          const isSelected = selectedDate
            ? date.toDateString() === selectedDate.toDateString()
            : false
          const isToday = date.toDateString() === today.toDateString()

          return (
            <button
              key={i}
              onClick={() => !isDisabled && onSelectDate(date)}
              disabled={isDisabled}
              className={[
                'text-center text-sm rounded-lg py-2 mx-0.5 transition-colors',
                isDisabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'hover:bg-gray-100 cursor-pointer',
                isSelected ? 'text-white font-semibold' : '',
                !isSelected && isToday ? 'font-semibold text-gray-900 underline' : '',
                !isSelected && !isDisabled ? 'text-gray-700' : '',
              ].join(' ')}
              style={isSelected ? { backgroundColor: accentColor } : undefined}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepSelectDateTime({
  page,
  service,
  slug,
  selectedDate,
  onSelectDate,
  onSelectSlot,
  onBack,
}: {
  page: BookingPage
  service: Service
  slug: string
  selectedDate: Date | null
  onSelectDate: (d: Date) => void
  onSelectSlot: (slot: string) => void
  onBack: () => void
}) {
  const [slots, setSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  useEffect(() => {
    if (!selectedDate) return
    setLoadingSlots(true)
    fetch(`/api/booking/${slug}/availability?serviceId=${service.id}&date=${toYMD(selectedDate)}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((data) => setSlots(data.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [selectedDate, service.id, slug])

  return (
    <div>
      <BackButton onClick={onBack} />
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Select Date & Time</h2>
      <p className="text-sm text-gray-500 mb-5">
        {service.name} · {service.duration_minutes} min · {formatPrice(service.unit_price)}
      </p>

      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm mb-4">
        <CalendarGrid
          advanceDays={page.advanceDays}
          accentColor={page.accentColor}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
        />
      </div>

      {selectedDate && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-700 mb-3">{formatDate(selectedDate)}</p>
          {loadingSlots ? (
            <p className="text-sm text-gray-400">Loading availability...</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-gray-400">No availability on this date.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => onSelectSlot(slot)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  {formatTime(slot)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Info + Intake ─────────────────────────────────────────────────────

function StepYourInfo({
  page,
  service,
  selectedDate,
  selectedSlot,
  slug,
  onConfirmed,
  onBack,
  onSlotTaken,
}: {
  page: BookingPage
  service: Service
  selectedDate: Date
  selectedSlot: string
  slug: string
  onConfirmed: (resp: ConfirmResponse) => void
  onBack: () => void
  onSlotTaken: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [intakeData, setIntakeData] = useState<Record<string, string | boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const intakeForm = service.intakeForm

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!firstName.trim()) errs.firstName = 'Required'
    if (!lastName.trim()) errs.lastName = 'Required'
    if (!email.trim()) errs.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email'
    if (!phone.trim()) errs.phone = 'Required'

    if (intakeForm) {
      for (const field of intakeForm.fields) {
        if (field.required) {
          const val = intakeData[field.id]
          if (field.type === 'checkbox') {
            if (!val) errs[field.id] = 'Required'
          } else {
            if (!val || String(val).trim() === '') errs[field.id] = 'Required'
          }
        }
      }
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    if (submitting) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch(`/api/booking/${slug}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          date: toYMD(selectedDate),
          startTime: selectedSlot,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes: notes.trim() || undefined,
          intakeFormId: intakeForm?.id ?? undefined,
          intakeData: intakeForm ? intakeData : undefined,
        }),
      })

      if (res.status === 409) {
        onSlotTaken()
        return
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setSubmitError(
          (errData as { error?: string }).error ?? 'Something went wrong. Please try again.'
        )
        return
      }

      const data = (await res.json()) as ConfirmResponse
      onConfirmed(data)
    } catch {
      setSubmitError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = (field: string) =>
    `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
      errors[field]
        ? 'border-red-300 focus:border-red-500'
        : 'border-gray-200 focus:border-gray-400'
    }`

  return (
    <div>
      <BackButton onClick={onBack} />
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Your Information</h2>
      <p className="text-sm text-gray-500 mb-5">
        {service.name} · {formatDate(selectedDate)} at {formatTime(selectedSlot)}
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass('firstName')}
                placeholder="Jane"
              />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass('lastName')}
                placeholder="Smith"
              />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass('email')}
              placeholder="jane@example.com"
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Phone <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass('phone')}
              placeholder="(555) 000-0000"
            />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors resize-none"
              placeholder="Anything we should know?"
            />
          </div>
        </div>

        {/* Dynamic intake form */}
        {intakeForm && intakeForm.fields.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm mt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-800">{intakeForm.name}</p>
            {intakeForm.fields.map((field) => (
              <div key={field.id}>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>

                {field.type === 'textarea' ? (
                  <textarea
                    rows={3}
                    required={field.required}
                    value={String(intakeData[field.id] ?? '')}
                    onChange={(e) => setIntakeData((d) => ({ ...d, [field.id]: e.target.value }))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors resize-none ${errors[field.id] ? 'border-red-300' : 'border-gray-200'}`}
                  />
                ) : field.type === 'select' ? (
                  <select
                    required={field.required}
                    value={String(intakeData[field.id] ?? '')}
                    onChange={(e) => setIntakeData((d) => ({ ...d, [field.id]: e.target.value }))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors ${errors[field.id] ? 'border-red-300' : 'border-gray-200'}`}
                  >
                    <option value="">Select...</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(intakeData[field.id])}
                      onChange={(e) =>
                        setIntakeData((d) => ({ ...d, [field.id]: e.target.checked }))
                      }
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-600">{field.label}</span>
                  </div>
                ) : (
                  <input
                    type={field.type}
                    required={field.required}
                    value={String(intakeData[field.id] ?? '')}
                    onChange={(e) => setIntakeData((d) => ({ ...d, [field.id]: e.target.value }))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-gray-400 transition-colors ${errors[field.id] ? 'border-red-300' : 'border-gray-200'}`}
                  />
                )}

                {errors[field.id] && (
                  <p className="text-xs text-red-500 mt-1">{errors[field.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {submitError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-lg px-6 py-3 text-white font-medium disabled:opacity-60 transition-opacity"
          style={{ backgroundColor: page.accentColor }}
        >
          {submitting ? 'Booking...' : 'Confirm Booking'}
        </button>
      </form>
    </div>
  )
}

// ─── Step 4: Confirmation ──────────────────────────────────────────────────────

function StepConfirmation({
  page,
  service,
  selectedDate,
  selectedSlot,
  firstName,
  lastName,
  confirmationMessage,
  onBookAnother,
}: {
  page: BookingPage
  service: Service
  selectedDate: Date
  selectedSlot: string
  firstName: string
  lastName: string
  confirmationMessage: string
  onBookAnother: () => void
}) {
  return (
    <div className="text-center">
      {/* Checkmark */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
        style={{ backgroundColor: page.accentColor }}
      >
        <svg
          className="w-8 h-8 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-2">You're booked!</h2>
      <p className="text-sm text-gray-500 mb-6">{confirmationMessage}</p>

      {/* Summary card */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm text-left space-y-3 mb-6">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Service</span>
          <span className="font-medium text-gray-900">{service.name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Date</span>
          <span className="font-medium text-gray-900">{formatDate(selectedDate)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Time</span>
          <span className="font-medium text-gray-900">{formatTime(selectedSlot)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Name</span>
          <span className="font-medium text-gray-900">
            {firstName} {lastName}
          </span>
        </div>
      </div>

      {/* Google review */}
      {page.googleReviewUrl && (
        <a
          href={page.googleReviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-3"
        >
          Leave us a review!
        </a>
      )}

      <button
        onClick={onBookAnother}
        className="w-full rounded-lg px-6 py-3 text-white font-medium"
        style={{ backgroundColor: page.accentColor }}
      >
        Book another appointment
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const params = useParams()
  const slug = params?.slug as string

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [page, setPage] = useState<BookingPage | null>(null)

  // Multi-step state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [confirmationMessage, setConfirmationMessage] = useState('')

  // Fetch booking page on mount
  useEffect(() => {
    if (!slug) return
    fetch(`/api/booking/${slug}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true)
          return
        }
        if (!r.ok) {
          setNotFound(true)
          return
        }
        const data = (await r.json()) as BookingPage
        setPage(data)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  function reset() {
    setStep(1)
    setSelectedService(null)
    setSelectedDate(null)
    setSelectedSlot(null)
    setFirstName('')
    setLastName('')
    setConfirmationMessage('')
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    )
  }

  if (notFound || !page) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Booking page not found</h1>
          <p className="text-sm text-gray-500">
            This booking link may have expired or doesn't exist. Please check with the business
            directly.
          </p>
        </div>
      </div>
    )
  }

  const accentColor = page.accentColor || '#0d9488'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: accentColor }}
          >
            <span className="text-white text-sm font-bold">
              {page.businessName.charAt(0).toUpperCase()}
            </span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">{page.businessName}</h1>
          {step > 1 && step < 4 && <p className="text-xs text-gray-400 mt-1">Step {step} of 3</p>}
        </div>

        {/* Steps */}
        {step === 1 && (
          <StepSelectService
            page={{ ...page, accentColor }}
            onSelect={(service) => {
              setSelectedService(service)
              setStep(2)
            }}
          />
        )}

        {step === 2 && selectedService && (
          <StepSelectDateTime
            page={{ ...page, accentColor }}
            service={selectedService}
            slug={slug}
            selectedDate={selectedDate}
            onSelectDate={(d) => {
              setSelectedDate(d)
              setSelectedSlot(null)
            }}
            onSelectSlot={(slot) => {
              setSelectedSlot(slot)
              setStep(3)
            }}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && selectedService && selectedDate && selectedSlot && (
          <StepYourInfo
            page={{ ...page, accentColor }}
            service={selectedService}
            selectedDate={selectedDate}
            selectedSlot={selectedSlot}
            slug={slug}
            onConfirmed={(resp) => {
              setConfirmationMessage(resp.confirmationMessage || page.confirmationMessage)
              setStep(4)
            }}
            onBack={() => setStep(2)}
            onSlotTaken={() => {
              setSelectedSlot(null)
              setSelectedDate(null)
              setStep(2)
            }}
          />
        )}

        {step === 4 && selectedService && selectedDate && selectedSlot && (
          <StepConfirmation
            page={{ ...page, accentColor }}
            service={selectedService}
            selectedDate={selectedDate}
            selectedSlot={selectedSlot}
            firstName={firstName}
            lastName={lastName}
            confirmationMessage={confirmationMessage || page.confirmationMessage}
            onBookAnother={reset}
          />
        )}

        <p className="text-center text-[10px] text-gray-300 mt-8">Powered by Nuatis</p>
      </div>
    </div>
  )
}
