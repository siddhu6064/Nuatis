'use client'

import { useState, useEffect } from 'react'
import Switch from '@mui/material/Switch'

export default function OrdersSettingsPage() {
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const [autoDeduct, setAutoDeduct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/orders', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { orders_auto_deduct_inventory?: boolean } | null) => {
        if (data) setAutoDeduct(Boolean(data.orders_auto_deduct_inventory))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const handleChange = async (val: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/orders', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ orders_auto_deduct_inventory: val }),
      })
      if (res.ok) {
        setAutoDeduct(val)
        setToast({ type: 'success', msg: 'Saved' })
      } else {
        setToast({ type: 'error', msg: 'Failed to save' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Orders Settings</h1>
      <p className="text-sm text-ink4 mb-6">
        Control how orders interact with other parts of Nuatis.
      </p>

      <div className="bg-white rounded-xl border border-border-brand">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Order fulfillment</h2>
        </div>
        <div className="px-5 py-5">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink">
                  Auto-deduct inventory when an order is completed
                </p>
                <p className="text-xs text-ink3 mt-1">
                  When an order is marked completed, any line items linked to an inventory item will
                  automatically decrement the item quantity. Quantities clamp at zero — they never
                  go negative.
                </p>
              </div>
              <Switch
                checked={autoDeduct}
                onChange={(e) => void handleChange(e.target.checked)}
                disabled={saving}
                slotProps={{
                  input: { 'aria-label': 'Auto-deduct inventory when an order is completed' },
                }}
              />
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
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
