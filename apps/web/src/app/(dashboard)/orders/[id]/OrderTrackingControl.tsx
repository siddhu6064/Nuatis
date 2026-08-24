'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

interface Props {
  orderId: string
  initialTrackingNumber: string | null
  initialTrackingCarrier: string | null
}

export default function OrderTrackingControl({
  orderId,
  initialTrackingNumber,
  initialTrackingCarrier,
}: Props) {
  const [carrier, setCarrier] = useState(initialTrackingCarrier ?? '')
  const [number, setNumber] = useState(initialTrackingNumber ?? '')
  const [saved, setSaved] = useState({
    carrier: initialTrackingCarrier,
    number: initialTrackingNumber,
  })
  const [saving, setSaving] = useState(false)

  const dirty = carrier !== (saved.carrier ?? '') || number !== (saved.number ?? '')

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_carrier: carrier.trim() || null,
          tracking_number: number.trim() || null,
        }),
      })
      if (res.ok) setSaved({ carrier: carrier.trim() || null, number: number.trim() || null })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-4 mb-6">
      <h2 className="text-sm font-semibold text-ink mb-3">Delivery Tracking</h2>
      <div className="flex items-end gap-3 flex-wrap">
        <TextField
          label="Carrier"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          size="small"
          placeholder="UPS, FedEx, USPS…"
          sx={{ minWidth: 160 }}
        />
        <TextField
          label="Tracking number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        />
        <Button
          variant="outlined"
          size="small"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
      </div>
      {saved.number && (
        <p className="text-xs text-ink4 mt-2">Customer is texted once tracking is first added.</p>
      )}
    </div>
  )
}
