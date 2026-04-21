'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
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
  const { data: session } = useSession()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<'google' | 'outlook' | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [switchConfirm, setSwitchConfirm] = useState<'google' | 'outlook' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchStatus = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/calendar`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: CalendarStatus = await res.json()
        setStatus(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchStatus()
  }, [token, fetchStatus])

  // Show success toast for Outlook OAuth redirect
  useEffect(() => {
    if (searchParams.get('connected') === 'outlook') {
      showToast('success', 'Outlook Calendar connected successfully!')
      // Refresh status after successful connect
      if (token) fetchStatus()
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
    if (!token) return
    setConnecting('outlook')
    try {
      const res = await fetch(`/api/settings/calendar/outlook/auth-url`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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
    if (!token) return
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/settings/calendar/outlook`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
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

  const providerLabel = (p: 'google' | 'outlook') =>
    p === 'google' ? 'Google Calendar' : 'Microsoft 365 Calendar'

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar Integration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Calendar integration enables online booking, voice AI scheduling, and appointment
          management. Only one calendar provider can be active at a time.
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Connection Status</h2>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : !status?.connected ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 rounded-full bg-gray-300" />
              <span className="text-sm text-gray-500">No calendar connected</span>
            </div>
          ) : status.provider === 'google' ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <GoogleCalendarIcon />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Connected to Google Calendar</p>
                  {status.email && <p className="text-xs text-gray-400 truncate">{status.email}</p>}
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
                  <p className="text-sm font-medium text-gray-900">
                    Connected to Microsoft 365 Calendar
                  </p>
                  {status.email && <p className="text-xs text-gray-400 truncate">{status.email}</p>}
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
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {status?.connected ? 'Switch Provider' : 'Connect a Calendar'}
          </h2>
          {status?.connected && (
            <p className="text-xs text-gray-400 mt-0.5">
              Connecting a new provider will disconnect your current one.
            </p>
          )}
        </div>

        <div className="px-5 py-5 flex flex-col sm:flex-row gap-3">
          {/* Google Calendar */}
          <button
            onClick={() => handleSwitchAttempt('google')}
            disabled={connecting !== null || disconnecting}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Switch Provider Confirmation Dialog */}
      {switchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              Switch Calendar Provider?
            </h3>
            <p className="text-sm text-gray-500 mb-5">
              This will disconnect{' '}
              <strong>
                {status?.provider ? providerLabel(status.provider) : 'your current calendar'}
              </strong>{' '}
              and connect <strong>{providerLabel(switchConfirm)}</strong>. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSwitchConfirm(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
