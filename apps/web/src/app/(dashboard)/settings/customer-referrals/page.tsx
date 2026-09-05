'use client'

import { useState, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'

interface CustomerReferralSettings {
  enabled: boolean
  referrerRewardCents: number
  referredRewardCents: number
}

function centsToDollarsStr(cents: number): string {
  return (cents / 100).toFixed(2)
}

export default function CustomerReferralSettingsPage() {
  const [settings, setSettings] = useState<CustomerReferralSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/customer-referrals')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CustomerReferralSettings | null) => {
        if (data) setSettings(data)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleSave(next: CustomerReferralSettings) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/customer-referrals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to save')
      }
      const data = (await res.json()) as CustomerReferralSettings
      setSettings(data)
      setToast({ type: 'success', msg: 'Saved' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Customer Referrals</h1>
      <p className="text-sm text-ink4 mb-6">
        Let your customers refer their friends and earn a gift card reward when the friend books or
        buys. This is separate from your Nuatis "Refer & Earn" partner program.
      </p>

      <div className="bg-white rounded-xl border border-border-brand mb-8">
        <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Program</h2>
            <p className="text-xs text-ink4 mt-0.5">
              When on, customers see a referral link in their client portal.
            </p>
          </div>
          {loading ? null : (
            <Switch
              checked={settings?.enabled ?? false}
              onChange={(e) =>
                void handleSave({
                  enabled: e.target.checked,
                  referrerRewardCents: settings?.referrerRewardCents ?? 1000,
                  referredRewardCents: settings?.referredRewardCents ?? 0,
                })
              }
              disabled={saving}
              slotProps={{ input: { 'aria-label': 'Toggle customer referral program' } }}
            />
          )}
        </div>
        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : (
            <>
              <div>
                <p className="text-sm text-ink3 mb-2">
                  Gift card reward for the customer who referred a friend, issued once that friend
                  completes their first appointment or purchase.
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink4">$</span>
                  <TextField
                    size="small"
                    type="number"
                    value={centsToDollarsStr(settings?.referrerRewardCents ?? 1000)}
                    onChange={(e) =>
                      setSettings({
                        enabled: settings?.enabled ?? false,
                        referrerRewardCents: Math.round(Number(e.target.value) * 100),
                        referredRewardCents: settings?.referredRewardCents ?? 0,
                      })
                    }
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    sx={{ maxWidth: 140 }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-ink3 mb-2">
                  Optional reward for the referred friend too (leave $0 to skip — "give one, get
                  one" style).
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink4">$</span>
                  <TextField
                    size="small"
                    type="number"
                    value={centsToDollarsStr(settings?.referredRewardCents ?? 0)}
                    onChange={(e) =>
                      setSettings({
                        enabled: settings?.enabled ?? false,
                        referrerRewardCents: settings?.referrerRewardCents ?? 1000,
                        referredRewardCents: Math.round(Number(e.target.value) * 100),
                      })
                    }
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    sx={{ maxWidth: 140 }}
                  />
                </div>
              </div>

              <Button
                variant="outlined"
                size="small"
                disabled={saving}
                onClick={() =>
                  void handleSave({
                    enabled: settings?.enabled ?? false,
                    referrerRewardCents: settings?.referrerRewardCents ?? 1000,
                    referredRewardCents: settings?.referredRewardCents ?? 0,
                  })
                }
              >
                Save
              </Button>
            </>
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
