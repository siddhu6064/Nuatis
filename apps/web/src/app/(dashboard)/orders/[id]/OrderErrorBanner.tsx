'use client'

import { useState } from 'react'

interface Props {
  orderId: string
  initialError: string | null
}

export default function OrderErrorBanner({ orderId, initialError }: Props) {
  const [error, setError] = useState(initialError)
  const [dismissing, setDismissing] = useState(false)

  if (!error) return null

  async function handleDismiss() {
    setDismissing(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: null }),
      })
      if (res.ok) setError(null)
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start justify-between gap-3">
      <p className="text-sm font-medium text-red-800">⚠ {error}</p>
      <button
        type="button"
        onClick={() => void handleDismiss()}
        disabled={dismissing}
        className="text-xs font-medium text-red-700 hover:text-red-900 shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
