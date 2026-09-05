'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import { SlideOver } from '@/components/ui/SlideOver'
import type { Vendor, PurchaseOrder } from './types'

interface LineDraft {
  description: string
  quantity_ordered: string
  unit_cost: string
  inventory_item_id: string
}

function emptyLine(): LineDraft {
  return { description: '', quantity_ordered: '1', unit_cost: '', inventory_item_id: '' }
}

interface InventoryItemOption {
  id: string
  name: string
  sku: string | null
  unit_cost: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  vendors: Vendor[]
  onCreated: (po: PurchaseOrder) => void
}

export default function POCreateSlideOver({ open, onClose, vendors, onCreated }: Props) {
  const [vendorId, setVendorId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])

  useEffect(() => {
    if (open) {
      setVendorId(vendors[0]?.id ?? '')
      setExpectedDate('')
      setNotes('')
      setLines([emptyLine()])
      setError(null)
      fetch('/api/inventory')
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((data: { data: InventoryItemOption[] }) => setInventoryItems(data.data ?? []))
        .catch(() => setInventoryItems([]))
    }
  }, [open, vendors])

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  function selectInventoryItem(i: number, itemId: string) {
    const item = inventoryItems.find((it) => it.id === itemId)
    if (!item) {
      updateLine(i, { inventory_item_id: '' })
      return
    }
    setLines((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              inventory_item_id: itemId,
              description: l.description.trim() ? l.description : item.name,
              unit_cost: l.unit_cost.trim() ? l.unit_cost : String(item.unit_cost ?? ''),
            }
          : l
      )
    )
  }

  const subtotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantity_ordered) || 0
    const cost = Number(l.unit_cost) || 0
    return sum + qty * cost
  }, 0)

  async function handleSave() {
    setError(null)
    if (!vendorId) {
      setError('Choose a vendor')
      return
    }
    const items = lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        quantity_ordered: Math.max(1, Math.round(Number(l.quantity_ordered) || 0)),
        unit_cost: Number(l.unit_cost) || 0,
        inventory_item_id: l.inventory_item_id || null,
      }))
    if (items.length === 0) {
      setError('Add at least one line item')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: vendorId,
          expected_date: expectedDate || null,
          notes: notes.trim() || null,
          items,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to create purchase order')
        return
      }
      const created = (await res.json()) as PurchaseOrder
      onCreated(created)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="New purchase order">
      <div className="px-5 py-5 space-y-4">
        <FormControl size="small" fullWidth>
          <InputLabel id="po-vendor-label">Vendor</InputLabel>
          <Select
            labelId="po-vendor-label"
            label="Vendor"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            {vendors.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Expected date"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
          size="small"
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Items</label>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-start">
                {inventoryItems.length > 0 && (
                  <FormControl size="small" sx={{ width: 150, flexShrink: 0 }}>
                    <Select
                      displayEmpty
                      value={l.inventory_item_id}
                      onChange={(e) => selectInventoryItem(i, e.target.value)}
                      renderValue={(v) =>
                        v
                          ? (inventoryItems.find((it) => it.id === v)?.name ?? 'Stock item')
                          : 'Custom item'
                      }
                    >
                      <MenuItem value="">Custom item</MenuItem>
                      {inventoryItems.map((it) => (
                        <MenuItem key={it.id} value={it.id}>
                          {it.name}
                          {it.sku ? ` (${it.sku})` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                <TextField
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  placeholder="Qty"
                  type="number"
                  value={l.quantity_ordered}
                  onChange={(e) => updateLine(i, { quantity_ordered: e.target.value })}
                  size="small"
                  sx={{ width: 80 }}
                />
                <TextField
                  placeholder="$/unit"
                  type="number"
                  value={l.unit_cost}
                  onChange={(e) => updateLine(i, { unit_cost: e.target.value })}
                  size="small"
                  sx={{ width: 100 }}
                />
              </div>
            ))}
          </div>
          <Button
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            size="small"
            sx={{ mt: 1 }}
          >
            + Add line
          </Button>
        </div>

        <p className="text-sm text-ink3">
          Subtotal: <span className="font-medium text-ink">${subtotal.toFixed(2)}</span>
        </p>

        <TextField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          multiline
          rows={2}
          fullWidth
          size="small"
        />

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} variant="outlined" color="inherit">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} variant="contained">
            {saving ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}
