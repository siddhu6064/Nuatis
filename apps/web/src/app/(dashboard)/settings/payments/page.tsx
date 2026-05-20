'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SquareStatus {
  connected: boolean
  merchant_id?: string
  location_id?: string | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PaymentsSettingsPage() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()

  const [squareStatus, setSquareStatus] = useState<SquareStatus | null>(null)
  const [squareLoading, setSquareLoading] = useState(true)
  const [squareError, setSquareError] = useState<string | null>(null)
  const [connectingSquare, setConnectingSquare] = useState(false)

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
        {/* ── Stripe card ── */}
        <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Stripe</h2>
            {/* Stripe status is always env-var based — show a static badge */}
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              Not configured
            </span>
          </div>
          <p className="text-xs text-ink3">
            Configure Stripe by setting{' '}
            <code className="font-mono bg-bg px-1 py-0.5 rounded text-ink">STRIPE_SECRET_KEY</code>{' '}
            in your environment.
          </p>
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
                <button
                  type="button"
                  onClick={() => void handleDisconnectSquare()}
                  disabled={connectingSquare}
                  className="px-3 py-1.5 bg-white text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {connectingSquare ? 'Disconnecting…' : 'Disconnect'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnectSquare()}
                  disabled={connectingSquare}
                  className="px-3 py-1.5 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: '#006AFF' }}
                >
                  {connectingSquare ? 'Connecting…' : 'Connect Square'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
