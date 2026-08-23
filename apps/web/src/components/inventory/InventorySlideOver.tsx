'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { SlideOver } from '@/components/ui/SlideOver'

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

  return (
    <SlideOver onClose={onClose} open={open} title={isEdit ? 'Edit item' : 'Add item'}>
      <div className="px-5 py-5 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Name *</label>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={!!fieldErrors['name']}
            helperText={fieldErrors['name']}
            fullWidth
            size="small"
          />
        </div>

        {/* SKU */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">SKU</label>
          <TextField value={sku} onChange={(e) => setSku(e.target.value)} fullWidth size="small" />
        </div>

        {/* Quantity + Reorder threshold */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Quantity *</label>
            <TextField
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              error={!!fieldErrors['quantity']}
              helperText={fieldErrors['quantity']}
              fullWidth
              size="small"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Reorder threshold</label>
            <TextField
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              value={reorderThreshold}
              onChange={(e) => setReorderThreshold(Number(e.target.value))}
              error={!!fieldErrors['reorder_threshold']}
              helperText={fieldErrors['reorder_threshold']}
              fullWidth
              size="small"
            />
          </div>
        </div>

        {/* Unit cost + Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Unit cost ($)</label>
            <TextField
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 'any' } }}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              error={!!fieldErrors['unit_cost']}
              helperText={fieldErrors['unit_cost']}
              fullWidth
              size="small"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Unit</label>
            <TextField
              select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              fullWidth
              size="small"
            >
              {UNITS.map((u) => (
                <MenuItem key={u} value={u}>
                  {u}
                </MenuItem>
              ))}
            </TextField>
          </div>
        </div>

        {/* Supplier */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Supplier</label>
          <TextField
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            fullWidth
            size="small"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Notes</label>
          <TextField
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={3}
            fullWidth
            size="small"
          />
        </div>

        {apiError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            {apiError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} variant="outlined" color="inherit">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} variant="contained">
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Add'}
          </Button>
        </div>

        {/* Adjust quantity — edit mode only */}
        {isEdit && (
          <div className="mt-6 pt-5 border-t border-border-brand">
            <h3 className="text-sm font-semibold text-ink mb-1">Adjust quantity</h3>
            <p className="text-xs text-ink4 mb-3">
              Current: <span className="font-medium text-ink2">{currentQty ?? 0}</span>. Enter a
              delta (positive or negative) and a reason.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <TextField
                type="number"
                slotProps={{ htmlInput: { step: 'any' } }}
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                placeholder="Delta (e.g. -2 or 5)"
                size="small"
              />
              <TextField
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Reason"
                size="small"
              />
            </div>
            <Button
              onClick={() => void handleAdjust()}
              disabled={adjusting}
              size="small"
              color="inherit"
            >
              {adjusting ? 'Adjusting...' : 'Adjust'}
            </Button>
            {adjustToast && <p className="text-xs text-ink3 mt-2">{adjustToast}</p>}
          </div>
        )}
      </div>
    </SlideOver>
  )
}
