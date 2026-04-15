'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Contact {
  id: string
  full_name: string
  phone: string | null
  email: string | null
}

interface Service {
  id: string
  name: string
  unit_price: number
  unit: string | null
  category: string | null
}

interface LineItem {
  key: string
  service_id: string | null
  description: string
  quantity: number
  unit_price: number
}

const VALID_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
]

export default function QuoteBuilder({
  contacts,
  services,
}: {
  contacts: Contact[]
  services: Service[]
}) {
  const router = useRouter()
  const [contactId, setContactId] = useState('')
  const [title, setTitle] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [taxRate, setTaxRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [validDays, setValidDays] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Discount state
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage')
  const [discountValue, setDiscountValue] = useState(0)

  // CPQ settings
  const [cpqSettings, setCpqSettings] = useState({
    max_discount_pct: 20,
    require_approval_above: 15,
  })

  useState(() => {
    fetch('/api/cpq/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { max_discount_pct?: number; require_approval_above?: number } | null) => {
        if (data) {
          setCpqSettings({
            max_discount_pct: data.max_discount_pct ?? 20,
            require_approval_above: data.require_approval_above ?? 15,
          })
        }
      })
      .catch(() => {})
  })

  function addFromCatalog(svc: Service) {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        service_id: svc.id,
        description: svc.name,
        quantity: 1,
        unit_price: svc.unit_price,
      },
    ])
  }

  function addCustom() {
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), service_id: null, description: '', quantity: 1, unit_price: 0 },
    ])
  }

  function updateItem(key: string, field: string, value: string | number) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  // Discount calculation
  const discountPct = discountEnabled && discountType === 'percentage' ? discountValue : 0
  const discountAmount = discountEnabled
    ? discountType === 'percentage'
      ? Number(((subtotal * discountValue) / 100).toFixed(2))
      : discountValue
    : 0
  const discountedSubtotal = Math.max(0, subtotal - discountAmount)
  const taxAmount = discountedSubtotal * (taxRate / 100)
  const total = discountedSubtotal + taxAmount

  const discountExceedsMax =
    discountEnabled && discountType === 'percentage' && discountValue > cpqSettings.max_discount_pct
  const needsApproval =
    discountEnabled &&
    discountType === 'percentage' &&
    discountValue > cpqSettings.require_approval_above &&
    !discountExceedsMax

  async function save(andSend: boolean) {
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    if (items.length === 0) {
      setError('Add at least one line item')
      return
    }
    if (discountExceedsMax) {
      setError(`Discount exceeds maximum allowed (${cpqSettings.max_discount_pct}%)`)
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId || null,
          title,
          line_items: items.map((i) => ({
            service_id: i.service_id,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
          })),
          tax_rate: taxRate,
          notes: notes || null,
          valid_days: validDays,
          discount_pct: discountPct,
          discount_amount: discountAmount,
        }),
      })

      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Failed to create quote')
        return
      }

      const quote = await res.json()

      // If needs approval, skip auto-send (the API will set approval_status='pending')
      if (andSend && quote.id && !needsApproval) {
        await fetch(`/api/quotes/${quote.id}/send`, { method: 'POST' })
      }

      router.push(`/quotes/${quote.id}`)
    } catch {
      setError('Failed to save quote')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">New Quote</h1>

      <div className="space-y-6">
        {/* Contact + Title */}
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Contact</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select a contact...</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dental Treatment Plan"
              className={inputCls}
            />
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Line Items</h2>
            <div className="flex gap-2">
              <div className="relative group">
                <button className="text-xs text-teal-600 font-medium hover:text-teal-700">
                  + From Catalog
                </button>
                <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-60 overflow-y-auto">
                  {services.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addFromCatalog(s)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex justify-between"
                    >
                      <span className="text-gray-700">{s.name}</span>
                      <span className="text-gray-400">${s.unit_price}</span>
                    </button>
                  ))}
                  {services.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No services configured</p>
                  )}
                </div>
              </div>
              <button
                onClick={addCustom}
                className="text-xs text-gray-500 font-medium hover:text-gray-700"
              >
                + Custom Item
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Add line items from your service catalog or create custom items
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-gray-400 px-1">
                <div className="col-span-5">Description</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Price</div>
                <div className="col-span-2">Total</div>
                <div className="col-span-1" />
              </div>
              {items.map((item) => (
                <div key={item.key} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(item.key, 'description', e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="Description"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(item.key, 'quantity', parseFloat(e.target.value) || 0)
                      }
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                      min="0"
                      step="1"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={item.unit_price}
                      onChange={(e) =>
                        updateItem(item.key, 'unit_price', parseFloat(e.target.value) || 0)
                      }
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="col-span-2 text-sm text-gray-700 font-medium px-1">
                    ${(item.quantity * item.unit_price).toFixed(2)}
                  </div>
                  <div className="col-span-1 text-right">
                    <button
                      onClick={() => removeItem(item.key)}
                      className="text-gray-300 hover:text-red-500 text-sm"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Discount */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-900 cursor-pointer">
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={(e) => {
                setDiscountEnabled(e.target.checked)
                if (!e.target.checked) setDiscountValue(0)
              }}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            />
            Apply discount
          </label>

          {discountEnabled && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="radio"
                    name="discountType"
                    checked={discountType === 'percentage'}
                    onChange={() => {
                      setDiscountType('percentage')
                      setDiscountValue(0)
                    }}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  Percentage
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="radio"
                    name="discountType"
                    checked={discountType === 'fixed'}
                    onChange={() => {
                      setDiscountType('fixed')
                      setDiscountValue(0)
                    }}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  Fixed Amount
                </label>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  {discountType === 'fixed' && <span className="text-sm text-gray-500">$</span>}
                  <input
                    type="number"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-32 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent ${discountExceedsMax ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-teal-500'}`}
                    min="0"
                    max={discountType === 'percentage' ? 100 : undefined}
                    step={discountType === 'percentage' ? 1 : 0.01}
                  />
                  {discountType === 'percentage' && (
                    <span className="text-sm text-gray-500">%</span>
                  )}
                </div>
                {discountExceedsMax && (
                  <p className="text-xs text-red-600 mt-1">
                    Maximum discount is {cpqSettings.max_discount_pct}%
                  </p>
                )}
                {needsApproval && (
                  <p className="text-xs text-amber-600 mt-1">
                    This discount exceeds {cpqSettings.require_approval_above}% and requires owner
                    approval before the quote can be sent
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Totals + Options */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-900">${subtotal.toFixed(2)}</span>
              </div>
              {discountEnabled && discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-amber-600">
                    Discount{discountType === 'percentage' ? ` (${discountValue}%)` : ''}
                  </span>
                  <span className="text-amber-600">-${discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm items-center gap-2">
                <span className="text-gray-500">Tax (%)</span>
                <input
                  type="number"
                  value={taxRate}
                  onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                  className="w-20 px-2 py-1 text-sm text-right border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                  min="0"
                  step="0.1"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax</span>
                <span className="text-gray-700">${taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t border-gray-100 pt-2">
                <span className="text-gray-900">Total</span>
                <span className="text-teal-600">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Valid for</label>
              <select
                value={validDays}
                onChange={(e) => setValidDays(parseInt(e.target.value))}
                className={inputCls}
              >
                {VALID_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Error + Actions */}
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Save as Draft
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving || discountExceedsMax}
            className={`px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${needsApproval ? 'bg-amber-500 hover:bg-amber-600' : 'bg-teal-600 hover:bg-teal-700'}`}
          >
            {saving ? 'Saving...' : needsApproval ? 'Save & Submit for Approval' : 'Save & Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
