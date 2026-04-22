'use client'

import { useState, useEffect } from 'react'

export interface InventoryItem {
  id: string
  name: string
  sku: string | null
  quantity: number
  reorder_threshold: number
  unit_cost: number | null
  unit: string
  supplier: string | null
  notes: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  item?: InventoryItem
  onSaved: (item: InventoryItem) => void
}

const UNITS = ['each', 'box', 'kg', 'L', 'bag', 'roll', 'other'] as const

export default function InventorySlideOver({ open, onClose, item, onSaved }: Props) {
  const isEdit = Boolean(item)

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [reorderThreshold, setReorderThreshold] = useState(5)
  const [unitCost, setUnitCost] = useState<string>('')
  const [unit, setUnit] = useState<string>('each')
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const [adjustDelta, setAdjustDelta] = useState<string>('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustToast, setAdjustToast] = useState<string | null>(null)
  const [currentQty, setCurrentQty] = useState<number | null>(null)

  useEffect(() => {
    if (item) {
      setName(item.name)
      setSku(item.sku ?? '')
      setQuantity(Number(item.quantity ?? 0))
      setReorderThreshold(Number(item.reorder_threshold ?? 5))
      setUnitCost(item.unit_cost != null ? String(item.unit_cost) : '')
      setUnit(item.unit || 'each')
      setSupplier(item.supplier ?? '')
      setNotes(item.notes ?? '')
      setCurrentQty(Number(item.quantity ?? 0))
    } else {
      setName('')
      setSku('')
      setQuantity(0)
      setReorderThreshold(5)
      setUnitCost('')
      setUnit('each')
      setSupplier('')
      setNotes('')
      setCurrentQty(null)
    }
    setFieldErrors({})
    setApiError(null)
  }, [item, open])

  useEffect(() => {
    if (!adjustToast) return undefined
    const t = setTimeout(() => setAdjustToast(null), 3000)
    return () => clearTimeout(t)
  }, [adjustToast])

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs['name'] = 'Name is required'
    if (!Number.isFinite(quantity) || quantity < 0) errs['quantity'] = 'Quantity must be >= 0'
    if (!Number.isFinite(reorderThreshold) || reorderThreshold < 0) {
      errs['reorder_threshold'] = 'Must be >= 0'
    }
    if (unitCost !== '' && (!Number.isFinite(Number(unitCost)) || Number(unitCost) < 0)) {
      errs['unit_cost'] = 'Must be >= 0'
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    setApiError(null)

    const body: Record<string, unknown> = {
      name: name.trim(),
      sku: sku.trim() || null,
      quantity,
      reorder_threshold: reorderThreshold,
      unit_cost: unitCost === '' ? null : Number(unitCost),
      unit,
      supplier: supplier.trim() || null,
      notes: notes.trim() || null,
    }

    try {
      const url = isEdit ? `/api/inventory/${item?.id}` : '/api/inventory'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setApiError(err.error ?? 'Failed to save')
        return
      }
      const saved = (await res.json()) as InventoryItem
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  const handleAdjust = async () => {
    if (!item) return
    const delta = Number(adjustDelta)
    if (!Number.isFinite(delta) || delta === 0) {
      setAdjustToast('Delta must be a non-zero number')
      return
    }
    if (!adjustReason.trim()) {
      setAdjustToast('Reason is required')
      return
    }

    setAdjusting(true)
    try {
      const res = await fetch(`/api/inventory/${item.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, reason: adjustReason.trim() }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setAdjustToast(err.error ?? 'Failed to adjust')
        return
      }
      const updated = (await res.json()) as InventoryItem
      setCurrentQty(Number(updated.quantity ?? 0))
      setQuantity(Number(updated.quantity ?? 0))
      setAdjustDelta('')
      setAdjustReason('')
      setAdjustToast('Quantity adjusted')
      onSaved(updated)
    } finally {
      setAdjusting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto bg-white h-full w-full max-w-md border-l border-gray-200 shadow-xl overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit item' : 'Add item'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            {fieldErrors['name'] && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors['name']}</p>
            )}
          </div>

          {/* SKU */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">SKU</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>

          {/* Quantity + Reorder threshold */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Quantity *</label>
              <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
              {fieldErrors['quantity'] && (
                <p className="text-xs text-red-500 mt-1">{fieldErrors['quantity']}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Reorder threshold
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={reorderThreshold}
                onChange={(e) => setReorderThreshold(Number(e.target.value))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
              {fieldErrors['reorder_threshold'] && (
                <p className="text-xs text-red-500 mt-1">{fieldErrors['reorder_threshold']}</p>
              )}
            </div>
          </div>

          {/* Unit cost + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                Unit cost ($)
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
              {fieldErrors['unit_cost'] && (
                <p className="text-xs text-red-500 mt-1">{fieldErrors['unit_cost']}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Supplier */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Supplier</label>
            <input
              type="text"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>

          {apiError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {apiError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Add'}
            </button>
          </div>

          {/* Adjust quantity — edit mode only */}
          {isEdit && (
            <div className="mt-6 pt-5 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Adjust quantity</h3>
              <p className="text-xs text-gray-400 mb-3">
                Current: <span className="font-medium text-gray-700">{currentQty ?? 0}</span>. Enter
                a delta (positive or negative) and a reason.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <input
                  type="number"
                  step="any"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  placeholder="Delta (e.g. -2 or 5)"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                />
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Reason"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
                />
              </div>
              <button
                onClick={() => void handleAdjust()}
                disabled={adjusting}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {adjusting ? 'Adjusting...' : 'Adjust'}
              </button>
              {adjustToast && <p className="text-xs text-gray-500 mt-2">{adjustToast}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
