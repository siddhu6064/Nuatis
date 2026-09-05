'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { SlideOver } from '@/components/ui/SlideOver'
import { STATUS_LABEL, STATUS_COLOR, type PurchaseOrder } from './types'

interface Props {
  open: boolean
  onClose: () => void
  poId: string | null
  onUpdated: (po: PurchaseOrder) => void
}

export default function PODetail({ open, onClose, poId, onUpdated }: Props) {
  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !poId) {
      setPo(null)
      return
    }
    setError(null)
    fetch(`/api/purchase-orders/${poId}`)
      .then((r) => r.json())
      .then((data: PurchaseOrder) => {
        setPo(data)
        setReceiveQty({})
      })
  }, [open, poId])

  async function refresh() {
    if (!poId) return
    const res = await fetch(`/api/purchase-orders/${poId}`)
    const data = (await res.json()) as PurchaseOrder
    setPo(data)
    onUpdated(data)
  }

  async function doAction(action: 'send' | 'cancel') {
    if (!poId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? `Failed to ${action}`)
        return
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function doReceive() {
    if (!poId || !po?.items) return
    const items = po.items
      .map((item) => ({
        item_id: item.id,
        quantity_received_now: Math.round(Number(receiveQty[item.id]) || 0),
      }))
      .filter((i) => i.quantity_received_now > 0)

    if (items.length === 0) {
      setError('Enter a quantity received for at least one item')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to receive')
        return
      }
      await refresh()
      setReceiveQty({})
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title={po?.po_number ?? 'Purchase order'}>
      {!po ? (
        <p className="px-5 py-5 text-sm text-ink4">Loading…</p>
      ) : (
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-center justify-between">
            <span
              className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[po.status]}`}
            >
              {STATUS_LABEL[po.status]}
            </span>
            <span className="text-sm text-ink3">{po.vendor_name}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Items</label>
            <div className="space-y-2">
              {(po.items ?? []).map((item) => {
                const remaining = item.quantity_ordered - item.quantity_received
                return (
                  <div key={item.id} className="border border-border-brand rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink">{item.description}</span>
                      <span className="text-ink3 tabular-nums">
                        {item.quantity_received}/{item.quantity_ordered} @ $
                        {item.unit_cost.toFixed(2)}
                      </span>
                    </div>
                    {(po.status === 'sent' || po.status === 'partial') && remaining > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <TextField
                          type="number"
                          size="small"
                          placeholder={`Receive (max ${remaining})`}
                          value={receiveQty[item.id] ?? ''}
                          onChange={(e) =>
                            setReceiveQty((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          sx={{ width: 160 }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-sm text-ink3">
            Subtotal: <span className="font-medium text-ink">${po.subtotal.toFixed(2)}</span>
          </p>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {po.status === 'draft' && (
              <Button onClick={() => void doAction('send')} disabled={busy} variant="contained">
                Mark sent
              </Button>
            )}
            {(po.status === 'sent' || po.status === 'partial') && (
              <Button onClick={() => void doReceive()} disabled={busy} variant="contained">
                Receive
              </Button>
            )}
            {po.status !== 'received' && po.status !== 'cancelled' && (
              <Button
                onClick={() => void doAction('cancel')}
                disabled={busy}
                color="error"
                variant="outlined"
              >
                Cancel PO
              </Button>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  )
}
