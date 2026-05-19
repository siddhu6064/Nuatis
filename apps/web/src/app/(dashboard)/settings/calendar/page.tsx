'use client'

import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

// ── Icons ─────────────────────────────────────────────────────────────────────

function GoogleCalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        fill="white"
        stroke="#DADCE0"
        strokeWidth="1.5"
      />
      <rect x="3" y="7" width="18" height="3" fill="#4285F4" />
      <rect x="3" y="3" width="18" height="4" rx="2" fill="#4285F4" />
      <line x1="8" y1="3" x2="8" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <text x="12" y="18" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#4285F4">
        CAL
      </text>
    </svg>
  )
}

function OutlookCalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#0078D4" />
      <rect x="12" y="6" width="8" height="12" rx="1" fill="white" fillOpacity="0.9" />
      <rect x="13" y="8" width="6" height="1.5" rx="0.5" fill="#0078D4" />
      <rect x="13" y="11" width="6" height="1.5" rx="0.5" fill="#0078D4" />
      <rect x="13" y="14" width="4" height="1.5" rx="0.5" fill="#0078D4" />
      <rect x="4" y="8" width="7" height="8" rx="1" fill="white" fillOpacity="0.9" />
      <ellipse cx="7.5" cy="12" rx="2" ry="2.5" fill="#0078D4" />
    </svg>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarStatus {
  provider: 'google' | 'outlook' | null
  email: string | null
  connected: boolean
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarSettingsPage() {
  // useSearchParams must be inside a Suspense boundary during prerender (Next 16).
  return (
    <Suspense fallback={<div className="px-8 py-8 text-sm text-ink4">Loading…</div>}>
      <CalendarSettingsContent />
    </Suspense>
  )
}

function CalendarSettingsContent() {
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<'google' | 'outlook' | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [switchConfirm, setSwitchConfirm] = useState<'google' | 'outlook' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [savingVideo, setSavingVideo] = useState(false)
  const [primaryLocationId, setPrimaryLocationId] = useState<string | null>(null)
  const [reserveStatus, setReserveStatus] = useState<
    'not_submitted' | 'pending_approval' | 'approved' | 'rejected'
  >('not_submitted')
  const [placeId, setPlaceId] = useState('')
  const [merchantId, setMerchantId] = useState<string | null>(null)
  const [submittingReserve, setSubmittingReserve] = useState(false)
  const [savingPlaceId, setSavingPlaceId] = useState(false)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const [calRes, mayaRes, locRes] = await Promise.all([
        fetch(`/api/settings/calendar`),
        fetch(`/api/maya-settings`),
        fetch(`/api/locations`),
      ])
      if (calRes.ok) {
        const data: CalendarStatus = await calRes.json()
        setStatus(data)
      }
      if (mayaRes.ok) {
        const maya = (await mayaRes.json()) as { video_conferencing_enabled?: boolean }
        setVideoEnabled(maya.video_conferencing_enabled ?? false)
      }
      if (locRes.ok) {
        const locs = (await locRes.json()) as {
          id: string
          is_primary: boolean
        }[]
        const primary = locs.find((l) => l.is_primary)
        if (primary) {
          setPrimaryLocationId(primary.id)
          const reserveRes = await fetch(`/api/google-reserve/status/${primary.id}`)
          if (reserveRes.ok) {
            const r = (await reserveRes.json()) as {
              status: string
              merchant_id: string | null
              place_id: string | null
            }
            setReserveStatus(
              (r.status as 'not_submitted' | 'pending_approval' | 'approved' | 'rejected') ??
                'not_submitted'
            )
            setPlaceId(r.place_id ?? '')
            setMerchantId(r.merchant_id ?? null)
          }
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  // Show success toast for Outlook OAuth redirect
  useEffect(() => {
    if (searchParams.get('connected') === 'outlook') {
      showToast('success', 'Outlook Calendar connected successfully!')
      // Refresh status after successful connect
      void fetchStatus()
    }
    if (searchParams.get('error')) {
      const errCode = searchParams.get('error')
      showToast('error', `Calendar connection failed${errCode ? `: ${errCode}` : ''}`)
    }
  }, [searchParams])

  async function handleConnectGoogle() {
    // The proxy injects auth headers, so navigating directly to /api/auth/google
    // triggers the requireAuth middleware and redirects to Google consent screen.
    setConnecting('google')
    window.location.href = '/api/auth/google'
  }

  async function handleConnectOutlook() {
    setConnecting('outlook')
    try {
      const res = await fetch(`/api/settings/calendar/outlook/auth-url`)
      if (res.ok) {
        const data: { url: string } = await res.json()
        window.location.href = data.url
      } else {
        showToast('error', 'Failed to get Outlook auth URL')
        setConnecting(null)
      }
    } catch {
      showToast('error', 'Could not initiate Outlook connection')
      setConnecting(null)
    }
  }

  async function handleDisconnectOutlook() {
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/settings/calendar/outlook`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setStatus({ provider: null, email: null, connected: false })
        showToast('success', 'Outlook Calendar disconnected')
      } else {
        showToast('error', 'Failed to disconnect Outlook Calendar')
      }
    } catch {
      showToast('error', 'Failed to disconnect Outlook Calendar')
    } finally {
      setDisconnecting(false)
    }
  }

  function handleDisconnectGoogle() {
    // Google disconnect: no dedicated endpoint exists yet.
    // Direct user to re-connect which will overwrite, or note the limitation.
    showToast(
      'error',
      'Google Calendar disconnect is not yet available. Contact support to remove the connection.'
    )
  }

  // Called when clicking a provider button while already connected to another
  function handleSwitchAttempt(target: 'google' | 'outlook') {
    if (status?.connected && status.provider !== target) {
      setSwitchConfirm(target)
    } else {
      if (target === 'google') {
        handleConnectGoogle()
      } else {
        handleConnectOutlook()
      }
    }
  }

  async function confirmSwitch() {
    if (!switchConfirm) return
    const target = switchConfirm
    setSwitchConfirm(null)

    // Disconnect current provider first (if it's Outlook; Google has no endpoint yet)
    if (status?.provider === 'outlook') {
      await handleDisconnectOutlook()
    }
    // Then connect new provider
    if (target === 'google') {
      handleConnectGoogle()
    } else {
      handleConnectOutlook()
    }
  }

  async function saveVideoSettings(enabled: boolean) {
    setSavingVideo(true)
    try {
      const res = await fetch(`/api/maya-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_conferencing_enabled: enabled }),
      })
      if (res.ok) {
        setVideoEnabled(enabled)
        showToast('success', `Video conferencing ${enabled ? 'enabled' : 'disabled'}`)
      } else {
        showToast('error', 'Failed to update video conferencing setting')
      }
    } catch {
      showToast('error', 'Network error')
    } finally {
      setSavingVideo(false)
    }
  }

  async function savePlaceIdToLocation() {
    if (!primaryLocationId || !placeId.trim()) return
    setSavingPlaceId(true)
    try {
      await fetch(`/api/locations/${primaryLocationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_place_id: placeId.trim() }),
      })
    } catch {
      // non-fatal
    } finally {
      setSavingPlaceId(false)
    }
  }

  async function handleReserveSubmit() {
    if (!primaryLocationId) return
    setSubmittingReserve(true)
    try {
      await savePlaceIdToLocation()
      const res = await fetch(`/api/google-reserve/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: primaryLocationId }),
      })
      const data = (await res.json()) as { status?: string; message?: string; error?: string }
      if (res.ok) {
        setReserveStatus('pending_approval')
        showToast('success', data.message ?? 'Submitted for review')
      } else {
        showToast('error', data.error ?? 'Submission failed')
      }
    } catch {
      showToast('error', 'Network error')
    } finally {
      setSubmittingReserve(false)
    }
  }

  const providerLabel = (p: 'google' | 'outlook') =>
    p === 'google' ? 'Google Calendar' : 'Microsoft 365 Calendar'

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink">Calendar Integration</h1>
        <p className="text-sm text-ink3 mt-1">
          Calendar integration enables online booking, voice AI scheduling, and appointment
          management. Only one calendar provider can be active at a time.
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="rounded-xl border border-border-brand bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Connection Status</h2>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <div className="text-sm text-ink4">Loading…</div>
          ) : !status?.connected ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 rounded-full bg-gray-300" />
              <span className="text-sm text-ink3">No calendar connected</span>
            </div>
          ) : status.provider === 'google' ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <GoogleCalendarIcon />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Connected to Google Calendar</p>
                  {status.email && <p className="text-xs text-ink4 truncate">{status.email}</p>}
                </div>
              </div>
              <button
                onClick={handleDisconnectGoogle}
                className="shrink-0 text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <OutlookCalendarIcon />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Connected to Microsoft 365 Calendar
                  </p>
                  {status.email && <p className="text-xs text-ink4 truncate">{status.email}</p>}
                </div>
              </div>
              <button
                onClick={handleDisconnectOutlook}
                disabled={disconnecting}
                className="shrink-0 text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connect Options */}
      <div className="rounded-xl border border-border-brand bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">
            {status?.connected ? 'Switch Provider' : 'Connect a Calendar'}
          </h2>
          {status?.connected && (
            <p className="text-xs text-ink4 mt-0.5">
              Connecting a new provider will disconnect your current one.
            </p>
          )}
        </div>

        <div className="px-5 py-5 flex flex-col sm:flex-row gap-3">
          {/* Google Calendar */}
          <button
            onClick={() => handleSwitchAttempt('google')}
            disabled={connecting !== null || disconnecting}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-border-brand bg-white text-sm font-medium text-ink2 hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleCalendarIcon />
            {connecting === 'google' ? 'Redirecting…' : 'Connect Google Calendar'}
            {status?.provider === 'google' && (
              <span className="ml-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 rounded-full px-1.5 py-0.5">
                Active
              </span>
            )}
          </button>

          {/* Outlook Calendar */}
          <button
            onClick={() => handleSwitchAttempt('outlook')}
            disabled={connecting !== null || disconnecting}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-border-brand bg-white text-sm font-medium text-ink2 hover:bg-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <OutlookCalendarIcon />
            {connecting === 'outlook' ? 'Redirecting…' : 'Connect Microsoft 365 Calendar'}
            {status?.provider === 'outlook' && (
              <span className="ml-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 rounded-full px-1.5 py-0.5">
                Active
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Video Conferencing Card */}
      <div className="rounded-xl border border-border-brand bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Video Conferencing</h2>
          <p className="text-xs text-ink4 mt-0.5">
            Automatically generate a Google Meet link for each new appointment.
          </p>
        </div>
        <div className="px-5 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Auto-generate video links</p>
            <p className="text-xs text-ink4 mt-0.5">
              Provider: Google Meet
              {!status?.connected && ' — connect a calendar above to use Google Meet'}
            </p>
          </div>
          <button
            onClick={() => void saveVideoSettings(!videoEnabled)}
            disabled={savingVideo}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 ${
              videoEnabled ? 'bg-teal-600' : 'bg-gray-200'
            }`}
            role="switch"
            aria-checked={videoEnabled}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${
                videoEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Google Organic Booking Card */}
      <div className="rounded-xl border border-border-brand bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Google Organic Booking</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Add a &quot;Book&quot; button to your Google Search and Maps listing — free.
            </p>
          </div>
          {/* Status badge */}
          {reserveStatus === 'not_submitted' && (
            <span className="text-[11px] font-medium text-ink4 bg-gray-100 rounded-full px-2.5 py-0.5">
              Not Submitted
            </span>
          )}
          {reserveStatus === 'pending_approval' && (
            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
              Pending Approval
            </span>
          )}
          {reserveStatus === 'approved' && (
            <span className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
              ✓ Live on Google
            </span>
          )}
          {reserveStatus === 'rejected' && (
            <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-0.5">
              Rejected
            </span>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-ink3">
            Customers can book directly from Google Search and Maps results — no redirect needed.
            Requires Google partner approval (typically 2–4 weeks).
          </p>

          {reserveStatus === 'pending_approval' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Under review — Google typically responds in 2–4 weeks.
            </div>
          )}

          {reserveStatus === 'approved' && merchantId && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-sm font-semibold text-green-800">Live on Google ✓</p>
              <p className="text-xs text-green-700 mt-0.5">Merchant ID: {merchantId}</p>
            </div>
          )}

          {reserveStatus !== 'approved' && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1">Google Place ID</label>
              <input
                type="text"
                value={placeId}
                onChange={(e) => setPlaceId(e.target.value)}
                placeholder="ChIJ..."
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <p className="text-xs text-ink4 mt-1">
                Find yours at{' '}
                <a
                  href="https://developers.google.com/maps/documentation/places/web-service/place-id"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 underline"
                >
                  developers.google.com/maps/…/place-id
                </a>
              </p>
            </div>
          )}

          {(reserveStatus === 'not_submitted' || reserveStatus === 'rejected') && (
            <button
              onClick={() => void handleReserveSubmit()}
              disabled={submittingReserve || savingPlaceId || !placeId.trim()}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submittingReserve ? 'Submitting…' : 'Submit for Review'}
            </button>
          )}
        </div>
      </div>

      {/* Switch Provider Confirmation Dialog */}
      {switchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl mx-4">
            <h3 className="text-base font-semibold text-ink mb-2">Switch Calendar Provider?</h3>
            <p className="text-sm text-ink3 mb-5">
              This will disconnect{' '}
              <strong>
                {status?.provider ? providerLabel(status.provider) : 'your current calendar'}
              </strong>{' '}
              and connect <strong>{providerLabel(switchConfirm)}</strong>. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSwitchConfirm(null)}
                className="rounded-lg border border-border-brand px-4 py-2 text-sm font-medium text-ink2 hover:bg-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwitch}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
