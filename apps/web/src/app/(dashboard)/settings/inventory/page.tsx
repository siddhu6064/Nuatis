'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-teal-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function InventorySettingsPage() {
  const { data: session } = useSession()
  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [autoDeduct, setAutoDeduct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/inventory', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { inventory_auto_deduct?: boolean } | null) => {
        if (data) setAutoDeduct(Boolean(data.inventory_auto_deduct))
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
      const res = await fetch('/api/settings/inventory', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ inventory_auto_deduct: val }),
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
      <h1 className="text-xl font-bold text-gray-900 mb-1">Inventory Settings</h1>
      <p className="text-sm text-gray-400 mb-6">
        Control how inventory interacts with other parts of Nuatis.
      </p>

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Quote fulfillment</h2>
        </div>
        <div className="px-5 py-5">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Auto-deduct inventory when a quote is accepted
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  When a customer accepts a quote, any quote line items linked to an inventory item
                  will automatically decrement the item quantity. Quantities clamp at zero — they
                  never go negative.
                </p>
              </div>
              <Toggle
                checked={autoDeduct}
                onChange={(v) => void handleChange(v)}
                disabled={saving}
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
