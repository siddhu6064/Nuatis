'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'
import TextField from '@mui/material/TextField'

type OrderStatus = 'pending' | 'confirmed' | 'in_progress' | 'ready' | 'completed' | 'cancelled'

// Mirrors apps/api/src/routes/orders.ts's ALLOWED_TRANSITIONS — kept in sync
// manually since it's a small, stable map.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

interface Props {
  orderId: string
  status: string
}

export default function OrderStatusControl({ orderId, status }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const allowed = ALLOWED_TRANSITIONS[status as OrderStatus] ?? []
  const advanceTo = allowed.find((s) => s !== 'cancelled')

  async function transition(nextStatus: OrderStatus, reason?: string) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, cancel_reason: reason }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error || 'Failed to update status')
        return
      }
      setCancelModalOpen(false)
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (allowed.length === 0) return null

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {advanceTo && (
          <Button
            onClick={() => void transition(advanceTo)}
            disabled={saving}
            variant="contained"
            size="small"
          >
            Mark {STATUS_LABELS[advanceTo]}
          </Button>
        )}
        {allowed.includes('cancelled') && (
          <Button
            onClick={() => setCancelModalOpen(true)}
            disabled={saving}
            variant="outlined"
            color="error"
            size="small"
          >
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {cancelModalOpen && (
        <Modal
          onClose={() => setCancelModalOpen(false)}
          title="Cancel order?"
          maxWidth="xs"
          footer={
            <>
              <Button
                onClick={() => setCancelModalOpen(false)}
                variant="text"
                color="inherit"
                size="small"
              >
                Back
              </Button>
              <Button
                onClick={() => void transition('cancelled', cancelReason)}
                disabled={saving}
                variant="contained"
                color="error"
                size="small"
              >
                {saving ? 'Cancelling...' : 'Cancel order'}
              </Button>
            </>
          }
        >
          <TextField
            label="Reason (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            multiline
            rows={2}
            fullWidth
            size="small"
          />
        </Modal>
      )}
    </div>
  )
}
