'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { getFirstName } from '@nuatis/shared'

const stripePromise = process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']
  ? loadStripe(process.env['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'])
  : null

// ── Types ──────────────────────────────────────────────────────────────────────

interface Appointment {
  id: string
  start_time: string
  title: string | null
  status: string
  location_id: string | null
}

interface Quote {
  id: string
  quote_number: string | null
  description: string | null
  total: number
  status: string
  created_at: string
  public_token: string | null
}

interface Invoice {
  id: string
  invoice_number: string | null
  total: number
  balance_due: number
  status: string
  due_date: string | null
  created_at: string
  share_token: string | null
}

interface ReferralReward {
  contact_name: string | null
  status: string
  issued_at: string | null
}

interface ReferralData {
  code: string
  referral_url: string
  clicks: number
  reward_cents: number
  referred_reward_cents: number
  rewards: ReferralReward[]
}

interface PortalDocument {
  id: string
  filename: string
  file_type: string | null
  file_size: number | null
  created_at: string
  signed_url: string | null
}

interface PaymentMethodInfo {
  type: string
  last4: string | null
}

interface PortalData {
  contact: { full_name: string | null; email: string | null; phone: string | null } | null
  appointments: { upcoming: Appointment[]; past: Appointment[] }
  quotes: Quote[]
  invoices: Invoice[]
  documents: PortalDocument[]
  referral: ReferralData | null
  paymentMethod: PaymentMethodInfo | null
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface VerifyResult {
  valid: boolean
  contact_name?: string | null
  business_name?: string | null
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    confirmed: 'bg-green-50 text-green-700',
    pending: 'bg-amber-50 text-amber-700',
    completed: 'bg-teal-50 text-teal-700',
    cancelled: 'bg-gray-100 text-gray-500',
    no_show: 'bg-red-50 text-red-600',
    sent: 'bg-blue-50 text-blue-700',
    accepted: 'bg-green-50 text-green-700',
    due: 'bg-amber-50 text-amber-700',
    overdue: 'bg-red-50 text-red-600',
    received: 'bg-teal-50 text-teal-700',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ── Appointment card ──────────────────────────────────────────────────────────

function AppointmentCard({
  appt,
  token,
  onChanged,
}: {
  appt: Appointment
  token?: string
  onChanged?: () => void
}) {
  const [managing, setManaging] = useState(false)
  const date = new Date(appt.start_time)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const manageable = token && onChanged && appt.status !== 'canceled' && appt.status !== 'completed'

  return (
    <>
      <div className="flex items-start gap-4 p-4 bg-white rounded-xl border border-gray-100">
        <div className="text-center shrink-0 w-12">
          <p className="text-2xl font-bold text-gray-900 leading-none">{date.getDate()}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {date.toLocaleString('en-US', { month: 'short' })}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{appt.title ?? 'Appointment'}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {dateStr} at {timeStr}
          </p>
          {manageable && (
            <button
              type="button"
              onClick={() => setManaging(true)}
              className="mt-1.5 text-xs font-medium text-teal-600 hover:underline"
            >
              Manage
            </button>
          )}
        </div>
        <StatusBadge status={appt.status} />
      </div>
      {managing && token && onChanged && (
        <ManageAppointmentModal
          token={token}
          appointmentId={appt.id}
          onClose={() => setManaging(false)}
          onChanged={() => {
            setManaging(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

// ── Manage appointment modal (reschedule/cancel from inside the portal) ────────
// Mirrors the standalone public manage-booking page's view/reschedule flow
// (apps/web/src/app/book/manage/[token]/page.tsx) but scoped to a portal
// session — same underlying reschedule/cancel logic on the API side
// (lib/appointment-self-service.ts), just authenticated by the portal token +
// contact_id instead of an unguessable per-appointment link.

interface ManageEligibility {
  title: string
  start_time: string
  status: string
  min_notice_hours: number
  can_modify: boolean
}

interface Slot {
  start: string
  end: string
}

function ManageAppointmentModal({
  token,
  appointmentId,
  onClose,
  onChanged,
}: {
  token: string
  appointmentId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [info, setInfo] = useState<ManageEligibility | null>(null)
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/portal/appointments/${appointmentId}?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ManageEligibility>) : null))
      .then((d) => {
        if (d) setInfo(d)
      })
  }, [appointmentId, token])

  async function loadSlots(d: string) {
    setDate(d)
    setSlots(null)
    if (!d) return
    setLoadingSlots(true)
    try {
      const res = await fetch(
        `/api/portal/appointments/${appointmentId}/available-slots?token=${encodeURIComponent(token)}&date=${d}`
      )
      const body = (await res.json()) as { slots?: Slot[] }
      setSlots(body.slots ?? [])
    } finally {
      setLoadingSlots(false)
    }
  }

  async function confirmReschedule(slot: Slot) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/portal/appointments/${appointmentId}/reschedule?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, start_time: slot.start }),
        }
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to reschedule')
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function cancelAppt() {
    if (!confirm('Cancel this appointment?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/portal/appointments/${appointmentId}/cancel?token=${encodeURIComponent(token)}`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to cancel')
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!info ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            <h2 className="text-base font-semibold text-gray-900 mb-1">{info.title}</h2>
            <p className="text-sm text-gray-600 mb-4">
              {new Date(info.start_time).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}{' '}
              at{' '}
              {new Date(info.start_time).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
            )}

            {!info.can_modify ? (
              <p className="text-sm text-gray-500">
                This appointment can no longer be changed online — it starts in less than{' '}
                {info.min_notice_hours}h, or is already {info.status}. Please contact the business
                directly.
              </p>
            ) : mode === 'view' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('reschedule')}
                  className="flex-1 py-2 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  onClick={() => void cancelAppt()}
                  disabled={busy}
                  className="flex-1 py-2 px-4 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => void loadSlots(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
                {loadingSlots ? (
                  <p className="text-sm text-gray-400">Loading times…</p>
                ) : slots !== null ? (
                  slots.length === 0 ? (
                    <p className="text-sm text-gray-400">No times available that day.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map((s) => (
                        <button
                          key={s.start}
                          type="button"
                          onClick={() => void confirmReschedule(s)}
                          disabled={busy}
                          className="py-2 text-sm border border-gray-200 rounded-lg hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
                        >
                          {s.start}
                        </button>
                      ))}
                    </div>
                  )
                ) : null}
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  ← Back
                </button>
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── Book a new appointment (contact already known — no name/email/phone
// step, just service → optional staff → date → time). Mirrors
// ManageAppointmentModal's plain-overlay style; hits the new
// /api/portal/booking/* routes (portal.ts) rather than the public booking
// page's find-or-create-contact flow, since the portal already knows who
// this is. ─────────────────────────────────────────────────────────────────

interface BookableService {
  id: string
  name: string
  description: string | null
  duration_minutes: number | null
  unit_price: number
}

interface BookingStaffOption {
  id: string
  name: string
  color_hex: string
}

function BookAppointmentModal({
  token,
  onClose,
  onBooked,
}: {
  token: string
  onClose: () => void
  onBooked: () => void
}) {
  const [services, setServices] = useState<BookableService[] | null>(null)
  const [staffByService, setStaffByService] = useState<Record<string, BookingStaffOption[]>>({})
  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/portal/booking/services?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            services: BookableService[]
            staffByService: Record<string, BookingStaffOption[]>
          } | null
        ) => {
          if (d) {
            setServices(d.services)
            setStaffByService(d.staffByService)
          }
        }
      )
  }, [token])

  async function loadSlots(d: string) {
    setDate(d)
    setSlots(null)
    if (!d || !serviceId) return
    setLoadingSlots(true)
    try {
      const params = new URLSearchParams({ token, serviceId, date: d })
      if (staffId) params.set('staffId', staffId)
      const res = await fetch(`/api/portal/booking/availability?${params}`)
      const body = (await res.json()) as { slots?: Slot[] }
      setSlots(body.slots ?? [])
    } finally {
      setLoadingSlots(false)
    }
  }

  async function confirmBooking(slot: Slot) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/booking/confirm?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          date,
          startTime: slot.start,
          staffId: staffId || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to book appointment')
        return
      }
      onBooked()
    } finally {
      setBusy(false)
    }
  }

  const staffOptions = serviceId ? (staffByService[serviceId] ?? []) : []

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 mb-4">Book an appointment</h2>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {services === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-gray-500">
            Online booking isn't set up yet — please contact the business directly.
          </p>
        ) : (
          <div className="space-y-3">
            <select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value)
                setStaffId('')
                setDate('')
                setSlots(null)
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="">Select a service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — ${Number(s.unit_price).toFixed(2)}
                </option>
              ))}
            </select>

            {serviceId && staffOptions.length > 0 && (
              <select
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setSlots(null)
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                <option value="">No preference</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            {serviceId && (
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => void loadSlots(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            )}

            {loadingSlots ? (
              <p className="text-sm text-gray-400">Loading times…</p>
            ) : slots !== null ? (
              slots.length === 0 ? (
                <p className="text-sm text-gray-400">No times available that day.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => void confirmBooking(s)}
                      disabled={busy}
                      className="py-2 text-sm border border-gray-200 rounded-lg hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
                    >
                      {s.start}
                    </button>
                  ))}
                </div>
              )
            ) : null}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── Refer a Friend tab ───────────────────────────────────────────────────────

function ReferralTab({ referral }: { referral: ReferralData }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(referral.referral_url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Your referral link</h2>
        <p className="text-sm text-gray-500 mb-4">
          Share this link with a friend. When they book or make their first purchase, you'll get a $
          {(referral.reward_cents / 100).toFixed(2)} gift card
          {referral.referred_reward_cents > 0 &&
            ` — and they'll get $${(referral.referred_reward_cents / 100).toFixed(2)} too`}
          .
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={referral.referral_url}
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">{referral.clicks} clicks so far</p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Your referrals</h2>
        {referral.rewards.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            No referrals yet — share your link above.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {referral.rewards.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-700">{r.contact_name ?? 'A friend'}</span>
                <StatusBadge status={r.status === 'issued' ? 'accepted' : r.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Payment Method tab ───────────────────────────────────────────────────────

function AddPaymentMethodForm({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSaving(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Failed to save payment method')
      setSaving(false)
      return
    }

    // The saved-method columns are populated by the setup_intent.succeeded
    // webhook, which usually lands within a second or two of confirmSetup
    // resolving — give it a moment before refetching.
    setTimeout(onSaved, 1500)
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || saving}
        className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save payment method'}
      </button>
    </form>
  )
}

function PaymentMethodTab({
  paymentMethod,
  token,
  onChanged,
}: {
  paymentMethod: PaymentMethodInfo | null
  token: string
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  async function startAdd() {
    setAdding(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/portal/payment-method/setup-intent?token=${encodeURIComponent(token)}`,
        { method: 'POST' }
      )
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { clientSecret: string }
      setClientSecret(data.clientSecret)
    } catch {
      setLoadError('Could not start payment method setup. Please try again.')
      setAdding(false)
    }
  }

  async function handleRemove() {
    setRemoving(true)
    try {
      await fetch(`/api/portal/payment-method?token=${encodeURIComponent(token)}`, {
        method: 'DELETE',
      })
      onChanged()
    } finally {
      setRemoving(false)
    }
  }

  if (paymentMethod) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Payment method on file</h2>
        <p className="text-sm text-gray-500 mb-4">
          Used automatically for things like a late-cancellation or no-show fee, instead of sending
          you a separate payment link.
        </p>
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg">
          <span className="text-sm text-gray-800 capitalize">
            {paymentMethod.type === 'card' ? 'Card' : 'Bank account'}
            {paymentMethod.last4 && ` ending in ${paymentMethod.last4}`}
          </span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing}
            className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    )
  }

  if (!stripePromise) {
    return (
      <p className="text-sm text-gray-400 py-8 text-center">
        Payment method setup isn&apos;t available right now.
      </p>
    )
  }

  if (!adding) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5 text-center">
        <p className="text-sm text-gray-500 mb-4">No payment method saved yet.</p>
        <button
          type="button"
          onClick={() => void startAdd()}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          Add a payment method
        </button>
        {loadError && <p className="text-xs text-red-600 mt-3">{loadError}</p>}
      </div>
    )
  }

  if (!clientSecret) {
    return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <Elements stripe={stripePromise} options={{ clientSecret }}>
        <AddPaymentMethodForm onSaved={onChanged} />
      </Elements>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'appointments' | 'quotes-invoices' | 'documents' | 'referral' | 'payment-method'

function PortalDashboardContent() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const slug = params.slug
  const token = searchParams.get('token')

  const [businessName, setBusinessName] = useState<string>('Client Portal')
  const [contactName, setContactName] = useState<string | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('appointments')
  const [pastOpen, setPastOpen] = useState(false)
  const [booking, setBooking] = useState(false)

  useEffect(() => {
    if (!token) {
      router.replace(`/portal/${slug}`)
      return
    }

    // Verify + load data in parallel
    Promise.all([
      fetch(`/api/portal/verify?token=${encodeURIComponent(token)}`).then(
        (r) => r.json() as Promise<VerifyResult>
      ),
      fetch(`/api/portal/data?token=${encodeURIComponent(token)}`).then((r) => {
        if (!r.ok) throw new Error('Unauthorized')
        return r.json() as Promise<PortalData>
      }),
    ])
      .then(([verify, portalData]) => {
        if (!verify.valid) {
          router.replace(`/portal/${slug}?error=expired`)
          return
        }
        setBusinessName(verify.business_name ?? 'Client Portal')
        setContactName(verify.contact_name ?? null)
        setData(portalData)
      })
      .catch(() => {
        router.replace(`/portal/${slug}`)
      })
      .finally(() => setLoading(false))
  }, [token, slug, router])

  function refetchPortalData() {
    if (!token) return
    fetch(`/api/portal/data?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<PortalData>) : null))
      .then((portalData) => {
        if (portalData) setData(portalData)
      })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'appointments', label: 'Appointments' },
    { id: 'quotes-invoices', label: 'Quotes & Invoices' },
    { id: 'documents', label: 'Documents' },
    { id: 'payment-method', label: 'Payment Method' },
    ...(data.referral ? [{ id: 'referral' as Tab, label: 'Refer a Friend' }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900">{businessName}</h1>
            <p className="text-xs text-gray-500">Client Portal</p>
          </div>
          {contactName && <p className="text-sm text-gray-600">Hi, {getFirstName(contactName)}</p>}
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Appointments tab */}
        {activeTab === 'appointments' && (
          <div className="space-y-6">
            {/* Upcoming */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">Upcoming</h2>
                {token && (
                  <button
                    type="button"
                    onClick={() => setBooking(true)}
                    className="text-xs font-medium text-teal-600 hover:underline"
                  >
                    + Book new
                  </button>
                )}
              </div>
              {data.appointments.upcoming.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No upcoming appointments.</p>
              ) : (
                <div className="space-y-2">
                  {data.appointments.upcoming.map((appt) => (
                    <AppointmentCard
                      key={appt.id}
                      appt={appt}
                      token={token ?? undefined}
                      onChanged={refetchPortalData}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Past — collapsible */}
            {data.appointments.past.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setPastOpen((o) => !o)}
                  className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${pastOpen ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  Past ({data.appointments.past.length})
                </button>
                {pastOpen && (
                  <div className="space-y-2 opacity-70">
                    {data.appointments.past.map((appt) => (
                      <AppointmentCard key={appt.id} appt={appt} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {booking && token && (
              <BookAppointmentModal
                token={token}
                onClose={() => setBooking(false)}
                onBooked={() => {
                  setBooking(false)
                  refetchPortalData()
                }}
              />
            )}
          </div>
        )}

        {/* Quotes & Invoices tab */}
        {activeTab === 'quotes-invoices' && (
          <div className="space-y-6">
            {/* Quotes */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Quotes</h2>
              {data.quotes.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No quotes.</p>
              ) : (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-50">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          #
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Description
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Total
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.quotes.map((q) => (
                        <tr key={q.id}>
                          <td className="px-4 py-3 text-gray-500">{q.quote_number ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">
                            {q.description ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            ${q.total.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={q.status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {q.public_token && (
                              <a
                                href={`/quotes/view/${q.public_token}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-teal-600 hover:text-teal-700 text-xs font-medium"
                              >
                                View →
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Invoices */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Invoices</h2>
              {data.invoices.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No invoices.</p>
              ) : (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-50">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          #
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Total
                        </th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Balance
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Status
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">
                          Due
                        </th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-4 py-3 text-gray-500">{inv.invoice_number ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            ${inv.total.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            ${inv.balance_due.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={inv.status} />
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {inv.share_token && (
                              <a
                                href={`/invoices/public/${inv.share_token}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-teal-600 hover:text-teal-700 text-xs font-medium"
                              >
                                {inv.balance_due > 0 && inv.status !== 'void' ? 'Pay →' : 'View →'}
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Documents tab */}
        {activeTab === 'documents' && (
          <div>
            {data.documents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-400">No documents shared yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.documents.map((doc) => (
                  <li key={doc.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{doc.filename}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(doc.created_at).toLocaleDateString()}
                        {doc.file_size ? ` · ${formatFileSize(doc.file_size)}` : ''}
                      </p>
                    </div>
                    {doc.signed_url && (
                      <a
                        href={doc.signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-teal-600 hover:underline shrink-0"
                      >
                        Download
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Payment Method tab */}
        {activeTab === 'payment-method' && token && (
          <PaymentMethodTab
            paymentMethod={data.paymentMethod}
            token={token}
            onChanged={refetchPortalData}
          />
        )}

        {/* Refer a Friend tab */}
        {activeTab === 'referral' && data.referral && <ReferralTab referral={data.referral} />}
      </main>

      {/* Footer */}
      <footer className="py-8 text-center">
        <p className="text-xs text-gray-300">Powered by Nuatis</p>
      </footer>
    </div>
  )
}

export default function PortalDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900" />}>
      <PortalDashboardContent />
    </Suspense>
  )
}
