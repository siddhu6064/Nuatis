'use client'

import { useState, useEffect } from 'react'

interface CpqSettings {
  max_discount_pct: number
  require_approval_above: number
  deposit_pct: number
}

interface TaxSettings {
  tax_rate: number
  tax_label: string
}

export default function CpqSettingsForm() {
  const [settings, setSettings] = useState<CpqSettings>({
    max_discount_pct: 20,
    require_approval_above: 15,
    deposit_pct: 50,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [taxSettings, setTaxSettings] = useState<TaxSettings>({ tax_rate: 0, tax_label: 'Tax' })
  const [savingTax, setSavingTax] = useState(false)
  const [taxToast, setTaxToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/cpq/settings').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/tenants/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cpq, tax]: [CpqSettings | null, TaxSettings | null]) => {
        if (cpq) setSettings(cpq)
        if (tax) setTaxSettings(tax)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const validationError =
    settings.require_approval_above > settings.max_discount_pct
      ? 'Approval threshold cannot exceed maximum discount'
      : null

  async function save() {
    if (validationError) return
    setSaving(true)
    setToast(null)

    try {
      const res = await fetch('/api/cpq/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        setToast({ type: 'success', msg: 'Settings saved' })
      } else {
        const d = await res.json()
        setToast({ type: 'error', msg: d.error || 'Failed to save' })
      }
    } catch {
      setToast({ type: 'error', msg: 'Failed to save settings' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  async function saveTax() {
    setSavingTax(true)
    setTaxToast(null)
    try {
      const res = await fetch('/api/tenants/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(taxSettings),
      })
      if (res.ok) {
        const data = await res.json()
        setTaxSettings(data as TaxSettings)
        setTaxToast({ type: 'success', msg: 'Tax settings saved' })
      } else {
        const d = await res.json()
        setTaxToast({ type: 'error', msg: (d as { error?: string }).error ?? 'Failed to save' })
      }
    } catch {
      setTaxToast({ type: 'error', msg: 'Failed to save tax settings' })
    } finally {
      setSavingTax(false)
      setTimeout(() => setTaxToast(null), 3000)
    }
  }

  if (loading) {
    return <p className="text-sm text-ink4">Loading settings...</p>
  }

  const inputCls =
    'w-32 px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-border-brand p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Maximum Discount %</label>
          <p className="text-xs text-ink4 mb-2">
            The highest discount percentage allowed on any quote
          </p>
          <input
            type="number"
            value={settings.max_discount_pct}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                max_discount_pct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
              }))
            }
            className={inputCls}
            min="0"
            max="100"
            step="1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Require Approval Above %
          </label>
          <p className="text-xs text-ink4 mb-2">
            Quotes with discounts above this threshold require owner approval before sending. Must
            be less than or equal to max discount.
          </p>
          <input
            type="number"
            value={settings.require_approval_above}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                require_approval_above: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
              }))
            }
            className={`${inputCls} ${validationError ? 'border-red-300 focus:ring-red-500' : ''}`}
            min="0"
            max="100"
            step="1"
          />
          {validationError && <p className="text-xs text-red-600 mt-1">{validationError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Deposit Percentage</label>
          <p className="text-xs text-ink4 mb-2">
            Set to 0 to disable deposits. When enabled, clients will see the required deposit amount
            on their quote. Payment collection coming soon.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={settings.deposit_pct}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  deposit_pct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                }))
              }
              className={inputCls}
              min="0"
              max="100"
              step="1"
            />
            <span className="text-sm text-ink3">%</span>
          </div>
          {settings.deposit_pct > 0 && (
            <p className="text-xs text-teal-600 mt-2">
              On a $1,000 quote: Deposit ${((1000 * settings.deposit_pct) / 100).toFixed(0)} ·
              Remaining ${(1000 - (1000 * settings.deposit_pct) / 100).toFixed(0)}
            </p>
          )}
        </div>
      </div>

      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
        >
          {toast.msg}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving || !!validationError}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* ── Tax Settings ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5 mt-8">
        <div>
          <h2 className="text-sm font-semibold text-ink">Tax Settings</h2>
          <p className="text-xs text-ink4 mt-0.5">
            Applied automatically to all new quotes. Existing quotes are not affected.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Tax Label</label>
          <p className="text-xs text-ink4 mb-2">e.g. GST, VAT, Sales Tax</p>
          <input
            type="text"
            value={taxSettings.tax_label}
            onChange={(e) => setTaxSettings((s) => ({ ...s, tax_label: e.target.value }))}
            className={inputCls}
            placeholder="Tax"
            maxLength={40}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">Tax Rate</label>
          <p className="text-xs text-ink4 mb-2">
            {taxSettings.tax_rate === 0
              ? 'No tax currently applied to quotes'
              : `${taxSettings.tax_label || 'Tax'} of ${taxSettings.tax_rate}% will be added to new quotes`}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={taxSettings.tax_rate}
              onChange={(e) =>
                setTaxSettings((s) => ({
                  ...s,
                  tax_rate: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                }))
              }
              className={inputCls}
              min="0"
              max="100"
              step="0.01"
            />
            <span className="text-sm text-ink3">%</span>
          </div>
        </div>

        {taxToast && (
          <p
            className={`text-sm px-3 py-2 rounded-lg ${taxToast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
          >
            {taxToast.msg}
          </p>
        )}

        <button
          onClick={() => void saveTax()}
          disabled={savingTax}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {savingTax ? 'Saving...' : 'Save Tax Settings'}
        </button>
      </div>
    </div>
  )
}
