'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import MenuItem from '@mui/material/MenuItem'

interface PromoCode {
  id: string
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  max_redemptions: number | null
  redemption_count: number
  valid_until: string | null
  active: boolean
}

export default function PromoCodesSettingsPage() {
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [newCode, setNewCode] = useState('')
  const [newType, setNewType] = useState<'percent' | 'fixed'>('percent')
  const [newValue, setNewValue] = useState('')
  const [newMaxRedemptions, setNewMaxRedemptions] = useState('')
  const [newValidUntil, setNewValidUntil] = useState('')

  const fetchCodes = useCallback(async () => {
    const res = await fetch('/api/promo-codes')
    if (res.ok) {
      const data = (await res.json()) as { data: PromoCode[] }
      setCodes(data.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchCodes()
  }, [fetchCodes])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleCreate() {
    const code = newCode.trim()
    const value = Number(newValue)
    if (!code || !value || value <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          discount_type: newType,
          discount_value: value,
          max_redemptions: newMaxRedemptions ? Number(newMaxRedemptions) : undefined,
          valid_until: newValidUntil ? new Date(newValidUntil).toISOString() : undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to create code')
      }
      setNewCode('')
      setNewValue('')
      setNewMaxRedemptions('')
      setNewValidUntil('')
      await fetchCodes()
      setToast({ type: 'success', msg: 'Promo code created' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to create' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(promoCode: PromoCode) {
    const res = await fetch(`/api/promo-codes/${promoCode.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !promoCode.active }),
    })
    if (res.ok) {
      await fetchCodes()
    } else {
      setToast({ type: 'error', msg: 'Failed to update code' })
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Promo Codes</h1>
      <p className="text-sm text-ink4 mb-6">
        Reusable discount codes staff can apply when building a quote — separate from a one-off
        manual discount.
      </p>

      <div className="bg-white rounded-xl border border-border-brand mb-8">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Codes</h2>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : codes.length === 0 ? (
            <p className="text-sm text-ink4">No promo codes yet.</p>
          ) : (
            <div className="space-y-2">
              {codes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0"
                >
                  <div>
                    <span
                      className={`text-sm font-mono ${!c.active ? 'text-ink4 line-through' : 'text-ink'}`}
                    >
                      {c.code}
                    </span>
                    <span className="text-xs text-ink4 ml-2">
                      {c.discount_type === 'percent'
                        ? `${c.discount_value}%`
                        : `$${c.discount_value}`}
                      {c.max_redemptions != null &&
                        ` · ${c.redemption_count}/${c.max_redemptions} used`}
                      {c.max_redemptions == null &&
                        c.redemption_count > 0 &&
                        ` · ${c.redemption_count} used`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink4">{c.active ? 'Active' : 'Inactive'}</span>
                    <Switch
                      checked={c.active}
                      onChange={() => void handleToggleActive(c)}
                      size="small"
                      slotProps={{ input: { 'aria-label': `Toggle ${c.code} active` } }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-border-brand space-y-2">
            <div className="flex items-center gap-2">
              <TextField
                size="small"
                placeholder="Code (e.g. SUMMER20)"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                fullWidth
              />
              <TextField
                select
                size="small"
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'percent' | 'fixed')}
                sx={{ minWidth: 90 }}
              >
                <MenuItem value="percent">%</MenuItem>
                <MenuItem value="fixed">$</MenuItem>
              </TextField>
              <TextField
                size="small"
                type="number"
                placeholder="Value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: newType === 'percent' ? 1 : 0.01 } }}
                sx={{ maxWidth: 100 }}
              />
            </div>
            <div className="flex items-center gap-2">
              <TextField
                size="small"
                type="number"
                placeholder="Max redemptions (optional)"
                value={newMaxRedemptions}
                onChange={(e) => setNewMaxRedemptions(e.target.value)}
                slotProps={{ htmlInput: { min: 1 } }}
                fullWidth
              />
              <TextField
                size="small"
                type="date"
                label="Expires (optional)"
                value={newValidUntil}
                onChange={(e) => setNewValidUntil(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ minWidth: 170 }}
              />
              <Button
                variant="outlined"
                size="small"
                disabled={saving || !newCode.trim() || !newValue}
                onClick={() => void handleCreate()}
                sx={{ flexShrink: 0 }}
              >
                Add
              </Button>
            </div>
          </div>
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
