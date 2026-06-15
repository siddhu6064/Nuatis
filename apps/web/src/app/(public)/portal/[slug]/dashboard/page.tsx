'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { getFirstName } from '@nuatis/shared'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Appointment {
  id: string
  scheduled_at: string
  service_name: string | null
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
}

interface PortalData {
  contact: { full_name: string | null; email: string | null; phone: string | null } | null
  appointments: { upcoming: Appointment[]; past: Appointment[] }
  quotes: Quote[]
  invoices: Invoice[]
  documents: unknown[]
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

function AppointmentCard({ appt }: { appt: Appointment }) {
  const date = new Date(appt.scheduled_at)
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex items-start gap-4 p-4 bg-white rounded-xl border border-gray-100">
      <div className="text-center shrink-0 w-12">
        <p className="text-2xl font-bold text-gray-900 leading-none">{date.getDate()}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {date.toLocaleString('en-US', { month: 'short' })}
        </p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{appt.service_name ?? 'Appointment'}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {dateStr} at {timeStr}
        </p>
      </div>
      <StatusBadge status={appt.status} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'appointments' | 'quotes-invoices' | 'documents'

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
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Upcoming</h2>
              {data.appointments.upcoming.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No upcoming appointments.</p>
              ) : (
                <div className="space-y-2">
                  {data.appointments.upcoming.map((appt) => (
                    <AppointmentCard key={appt.id} appt={appt} />
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
          <div className="py-12 text-center">
            <p className="text-sm text-gray-400">Document sharing coming soon.</p>
          </div>
        )}
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
