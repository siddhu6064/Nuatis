'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import Button from '@mui/material/Button'

const API_URL = ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface SquareStatus {
  connected: boolean
  merchant_id?: string
  location_id?: string | null
}

interface StripeConnectStatus {
  connected: boolean
  status?: 'none' | 'pending' | 'active' | 'restricted'
  charges_enabled?: boolean
  payouts_enabled?: boolean
  account_id?: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PaymentsSettingsContent() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()

  const [squareStatus, setSquareStatus] = useState<SquareStatus | null>(null)
  const [squareLoading, setSquareLoading] = useState(true)
  const [squareError, setSquareError] = useState<string | null>(null)
  const [connectingSquare, setConnectingSquare] = useState(false)

  const [stripeConnectStatus, setStripeConnectStatus] = useState<StripeConnectStatus | null>(null)
  const [stripeConnectLoading, setStripeConnectLoading] = useState(true)
  const [stripeConnectError, setStripeConnectError] = useState<string | null>(null)
  const [connectingStripe, setConnectingStripe] = useState(false)

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Add auth token if present in session
  const token = (session as { accessToken?: string } | null)?.accessToken
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`
  }

  // Check URL params on mount for OAuth callback result
  useEffect(() => {
    const squareParam = searchParams.get('square')
    if (squareParam === 'connected') {
      setToast({ type: 'success', msg: 'Square connected successfully!' })
      setTimeout(() => setToast(null), 5000)
    } else if (squareParam === 'error') {
      setToast({ type: 'error', msg: 'Failed to connect Square. Please try again.' })
      setTimeout(() => setToast(null), 5000)
    }

    const stripeConnectParam = searchParams.get('stripe_connect')
    if (stripeConnectParam === 'return') {
      setToast({ type: 'success', msg: 'Stripe account status updated.' })
      setTimeout(() => setToast(null), 5000)
      refreshStripeConnectStatus()
    } else if (stripeConnectParam === 'error') {
      setToast({ type: 'error', msg: 'Failed to connect Stripe. Please try again.' })
      setTimeout(() => setToast(null), 5000)
    }
  }, [searchParams])

  // Fetch Square status on mount
  useEffect(() => {
    setSquareLoading(true)
    fetch(`${API_URL}/api/square/status`, { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SquareStatus | null) => {
        if (data) setSquareStatus(data)
      })
      .catch(() => {})
      .finally(() => setSquareLoading(false))
  }, []) // intentional: only fetch once on mount

  function refreshStripeConnectStatus() {
    setStripeConnectLoading(true)
    fetch(`${API_URL}/api/stripe-connect/status`, { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: StripeConnectStatus | null) => {
        if (data) setStripeConnectStatus(data)
      })
      .catch(() => {})
      .finally(() => setStripeConnectLoading(false))
  }

  // Fetch Stripe Connect status on mount
  useEffect(() => {
    refreshStripeConnectStatus()
  }, []) // intentional: only fetch once on mount

  async function handleConnectStripe() {
    setConnectingStripe(true)
    setStripeConnectError(null)
    try {
      const res = await fetch(`${API_URL}/api/stripe-connect/connect`, { headers: authHeaders })
      if (res.ok) {
        const data = (await res.json()) as { url: string }
        window.location.href = data.url
      } else {
        const d = await res.json().catch(() => ({}))
        setStripeConnectError(
          (d as { error?: string }).error || 'Failed to start Stripe onboarding'
        )
      }
    } catch {
      setStripeConnectError('Failed to start Stripe onboarding')
    } finally {
      setConnectingStripe(false)
    }
  }

  async function handleDisconnectStripe() {
    setConnectingStripe(true)
    setStripeConnectError(null)
    try {
      const res = await fetch(`${API_URL}/api/stripe-connect/disconnect`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      if (res.ok) {
        setStripeConnectStatus({ connected: false, status: 'none' })
        setToast({ type: 'success', msg: 'Stripe disconnected successfully.' })
        setTimeout(() => setToast(null), 4000)
      } else {
        const d = await res.json().catch(() => ({}))
        setStripeConnectError((d as { error?: string }).error || 'Failed to disconnect Stripe')
      }
    } catch {
      setStripeConnectError('Failed to disconnect Stripe')
    } finally {
      setConnectingStripe(false)
    }
  }

  async function handleOpenStripeDashboard() {
    setStripeConnectError(null)
    try {
      const res = await fetch(`${API_URL}/api/stripe-connect/dashboard-link`, {
        headers: authHeaders,
      })
      if (res.ok) {
        const data = (await res.json()) as { url: string }
        window.open(data.url, '_blank', 'noopener,noreferrer')
      } else {
        const d = await res.json().catch(() => ({}))
        setStripeConnectError((d as { error?: string }).error || 'Failed to open Stripe dashboard')
      }
    } catch {
      setStripeConnectError('Failed to open Stripe dashboard')
    }
  }

  async function handleConnectSquare() {
    setConnectingSquare(true)
    setSquareError(null)
    try {
      const res = await fetch(`${API_URL}/api/square/connect`, { headers: authHeaders })
      if (res.ok) {
        const data = (await res.json()) as { url: string }
        window.location.href = data.url
      } else {
        const d = await res.json().catch(() => ({}))
        setSquareError((d as { error?: string }).error || 'Failed to initiate Square connection')
      }
    } catch {
      setSquareError('Failed to initiate Square connection')
    } finally {
      setConnectingSquare(false)
    }
  }

  async function handleDisconnectSquare() {
    setConnectingSquare(true)
    setSquareError(null)
    try {
      const res = await fetch(`${API_URL}/api/square/disconnect`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      if (res.ok) {
        setSquareStatus({ connected: false })
        setToast({ type: 'success', msg: 'Square disconnected successfully.' })
        setTimeout(() => setToast(null), 4000)
      } else {
        const d = await res.json().catch(() => ({}))
        setSquareError((d as { error?: string }).error || 'Failed to disconnect Square')
      }
    } catch {
      setSquareError('Failed to disconnect Square')
    } finally {
      setConnectingSquare(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Payment Providers</h1>
        <p className="text-sm text-ink3">
          Connect payment processors to accept payments on quotes.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${
            toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Stripe Connect card ── */}
        <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: '#635BFF' }}>
              Stripe
            </h2>
            {stripeConnectLoading ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                Loading…
              </span>
            ) : stripeConnectStatus?.status === 'active' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Connected
              </span>
            ) : stripeConnectStatus?.status === 'restricted' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                Restricted
              </span>
            ) : stripeConnectStatus?.status === 'pending' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                Onboarding started
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                Not connected
              </span>
            )}
          </div>

          <p className="text-xs text-ink3">
            Payments on invoices, gift cards, and payment links go straight to your own Stripe
            account. Nuatis takes a 2% platform fee per transaction.
          </p>

          {stripeConnectError && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg">
              {stripeConnectError}
            </p>
          )}

          {!stripeConnectLoading && (
            <div className="pt-1 flex gap-2 flex-wrap">
              {stripeConnectStatus?.status === 'active' ? (
                <>
                  <Button
                    onClick={() => void handleOpenStripeDashboard()}
                    size="small"
                    sx={{ bgcolor: '#635BFF', color: 'white', '&:hover': { bgcolor: '#4f46d6' } }}
                  >
                    Open Stripe Dashboard
                  </Button>
                  <Button
                    onClick={() => void handleDisconnectStripe()}
                    disabled={connectingStripe}
                    color="error"
                    variant="outlined"
                    size="small"
                  >
                    {connectingStripe ? 'Disconnecting…' : 'Disconnect'}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => void handleConnectStripe()}
                  disabled={connectingStripe}
                  size="small"
                  sx={{ bgcolor: '#635BFF', color: 'white', '&:hover': { bgcolor: '#4f46d6' } }}
                >
                  {connectingStripe
                    ? 'Starting…'
                    : stripeConnectStatus?.status === 'pending'
                      ? 'Finish onboarding'
                      : 'Connect Stripe'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── Square card ── */}
        <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: '#006AFF' }}>
              Square
            </h2>
            {squareLoading ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
                Loading…
              </span>
            ) : squareStatus?.connected ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                Not connected
              </span>
            )}
          </div>

          {/* Merchant ID when connected */}
          {squareStatus?.connected && squareStatus.merchant_id && (
            <p className="text-xs text-ink3">
              Merchant ID: <span className="font-mono text-ink">{squareStatus.merchant_id}</span>
            </p>
          )}

          {/* Error message */}
          {squareError && (
            <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-lg">{squareError}</p>
          )}

          {/* Action button */}
          {!squareLoading && (
            <div className="pt-1">
              {squareStatus?.connected ? (
                <Button
                  onClick={() => void handleDisconnectSquare()}
                  disabled={connectingSquare}
                  color="error"
                  variant="outlined"
                  size="small"
                >
                  {connectingSquare ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              ) : (
                <Button
                  onClick={() => void handleConnectSquare()}
                  disabled={connectingSquare}
                  size="small"
                  sx={{ bgcolor: '#006AFF', color: 'white', '&:hover': { bgcolor: '#0055cc' } }}
                >
                  {connectingSquare ? 'Connecting…' : 'Connect Square'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PaymentsSettingsPage() {
  return (
    <Suspense fallback={<div className="px-8 py-8 text-sm text-ink3">Loading…</div>}>
      <PaymentsSettingsContent />
    </Suspense>
  )
}
