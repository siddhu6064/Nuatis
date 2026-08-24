'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Button from '@mui/material/Button'

interface Props {
  quoteId: string
  existingOrderId: string | null
}

export default function ConvertToOrderButton({ quoteId, existingOrderId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (existingOrderId) {
    return (
      <Button component={Link} href={`/orders/${existingOrderId}`} variant="outlined" size="small">
        View Order
      </Button>
    )
  }

  async function convert() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/quotes/${quoteId}/convert-to-order`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error || 'Failed to convert')
        return
      }
      const order = await res.json()
      router.push(`/orders/${order.id}`)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-end">
      <Button onClick={() => void convert()} disabled={saving} variant="outlined" size="small">
        {saving ? 'Converting...' : 'Convert to Order'}
      </Button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
