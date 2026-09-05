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
  barcode: string | null
  quantity: number
  reorder_threshold: number
  unit_cost: number | null
  unit: string
  supplier: string | null
  notes: string | null
  parent_item_id?: string | null
  variant_label?: string | null
}

interface Movement {
  id: string
  body: string | null
  metadata: { delta?: number; new_quantity?: number; reason?: string }
  created_at: string
}

interface KitComponent {
  id: string
  component_item_id: string
  quantity: number
  component: { id: string; name: string; sku: string | null; quantity: number } | null
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
  const [barcode, setBarcode] = useState('')
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
  const [movements, setMovements] = useState<Movement[]>([])
  const [movementsLoading, setMovementsLoading] = useState(false)

  // Variants (only relevant when this item is NOT itself a variant)
  const [variants, setVariants] = useState<InventoryItem[]>([])
  const [newVariantLabel, setNewVariantLabel] = useState('')
  const [newVariantSku, setNewVariantSku] = useState('')
  const [newVariantQty, setNewVariantQty] = useState('0')
  const [addingVariant, setAddingVariant] = useState(false)

  // Kit components (only relevant when this item is NOT a variant)
  const [kitComponents, setKitComponents] = useState<KitComponent[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [itemSearchResults, setItemSearchResults] = useState<InventoryItem[]>([])
  const [savingKit, setSavingKit] = useState(false)
  const [buildQty, setBuildQty] = useState('1')
  const [buildReason, setBuildReason] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildToast, setBuildToast] = useState<string | null>(null)

  useEffect(() => {
    if (item) {
      setName(item.name)
      setSku(item.sku ?? '')
      setBarcode(item.barcode ?? '')
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
      setBarcode('')
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
    setMovements([])
    setVariants([])
    setKitComponents([])
    setNewVariantLabel('')
    setNewVariantSku('')
    setNewVariantQty('0')
  }, [item, open])

  useEffect(() => {
    if (!open || !item) return
    setMovementsLoading(true)
    fetch(`/api/inventory/${item.id}/movements`)
      .then((r) => (r.ok ? r.json() : { movements: [] }))
      .then((d: { movements: Movement[] }) => setMovements(d.movements ?? []))
      .finally(() => setMovementsLoading(false))
  }, [open, item])

  const isVariant = Boolean(item?.parent_item_id)

  const refreshVariants = () => {
    if (!item) return
    fetch(`/api/inventory/${item.id}/variants`)
      .then((r) => (r.ok ? r.json() : { variants: [] }))
      .then((d: { variants: InventoryItem[] }) => setVariants(d.variants ?? []))
  }

  const refreshKitComponents = () => {
    if (!item) return
    fetch(`/api/inventory/${item.id}/kit-components`)
      .then((r) => (r.ok ? r.json() : { components: [] }))
      .then((d: { components: KitComponent[] }) => setKitComponents(d.components ?? []))
  }

  useEffect(() => {
    if (!open || !item || isVariant) return
    refreshVariants()
    refreshKitComponents()
  }, [open, item, isVariant])

  useEffect(() => {
    if (!itemSearch.trim() || !item) {
      setItemSearchResults([])
      return undefined
    }
    const t = setTimeout(() => {
      fetch(`/api/inventory?q=${encodeURIComponent(itemSearch.trim())}&limit=10`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d: { data: InventoryItem[] }) =>
          setItemSearchResults((d.data ?? []).filter((i) => i.id !== item.id && !i.parent_item_id))
        )
    }, 250)
    return () => clearTimeout(t)
  }, [itemSearch, item])

  useEffect(() => {
    if (!adjustToast) return undefined
    const t = setTimeout(() => setAdjustToast(null), 3000)
    return () => clearTimeout(t)
  }, [adjustToast])

  useEffect(() => {
    if (!buildToast) return undefined
    const t = setTimeout(() => setBuildToast(null), 3000)
    return () => clearTimeout(t)
  }, [buildToast])

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
      barcode: barcode.trim() || null,
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
      fetch(`/api/inventory/${item.id}/movements`)
        .then((r) => (r.ok ? r.json() : { movements: [] }))
        .then((d: { movements: Movement[] }) => setMovements(d.movements ?? []))
    } finally {
      setAdjusting(false)
    }
  }

  const handleAddVariant = async () => {
    if (!item) return
    if (!newVariantLabel.trim()) {
      setAdjustToast('Variant label is required')
      return
    }
    setAddingVariant(true)
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${item.name} — ${newVariantLabel.trim()}`,
          quantity: Number(newVariantQty) || 0,
          sku: newVariantSku.trim() || undefined,
          parent_item_id: item.id,
          variant_label: newVariantLabel.trim(),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setAdjustToast(err.error ?? 'Failed to add variant')
        return
      }
      setNewVariantLabel('')
      setNewVariantSku('')
      setNewVariantQty('0')
      refreshVariants()
    } finally {
      setAddingVariant(false)
    }
  }

  const saveKitComponents = async (next: KitComponent[]) => {
    if (!item) return
    setSavingKit(true)
    try {
      const res = await fetch(`/api/inventory/${item.id}/kit-components`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: next.map((c) => ({
            component_item_id: c.component_item_id,
            quantity: c.quantity,
          })),
        }),
      })
      if (res.ok) refreshKitComponents()
    } finally {
      setSavingKit(false)
    }
  }

  const handleAddKitComponent = (candidate: InventoryItem) => {
    if (kitComponents.some((c) => c.component_item_id === candidate.id)) return
    const next: KitComponent[] = [
      ...kitComponents,
      {
        id: `pending-${candidate.id}`,
        component_item_id: candidate.id,
        quantity: 1,
        component: {
          id: candidate.id,
          name: candidate.name,
          sku: candidate.sku,
          quantity: candidate.quantity,
        },
      },
    ]
    setKitComponents(next)
    setItemSearch('')
    setItemSearchResults([])
    void saveKitComponents(next)
  }

  const handleRemoveKitComponent = (componentItemId: string) => {
    const next = kitComponents.filter((c) => c.component_item_id !== componentItemId)
    setKitComponents(next)
    void saveKitComponents(next)
  }

  const handleKitComponentQtyChange = (componentItemId: string, quantity: number) => {
    const next = kitComponents.map((c) =>
      c.component_item_id === componentItemId ? { ...c, quantity } : c
    )
    setKitComponents(next)
  }

  const handleBuild = async () => {
    if (!item) return
    const qty = Number(buildQty)
    if (!Number.isFinite(qty) || qty <= 0) {
      setBuildToast('Quantity must be > 0')
      return
    }
    setBuilding(true)
    try {
      const res = await fetch(`/api/inventory/${item.id}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, reason: buildReason.trim() || undefined }),
      })
      const body = (await res.json().catch(() => ({}))) as InventoryItem & { error?: string }
      if (!res.ok) {
        setBuildToast(body.error ?? 'Failed to build')
        return
      }
      setBuildToast(`Built ${qty} — now ${body.quantity} on hand`)
      setCurrentQty(Number(body.quantity ?? 0))
      setQuantity(Number(body.quantity ?? 0))
      setBuildQty('1')
      setBuildReason('')
      onSaved(body)
      fetch(`/api/inventory/${item.id}/movements`)
        .then((r) => (r.ok ? r.json() : { movements: [] }))
        .then((d: { movements: Movement[] }) => setMovements(d.movements ?? []))
    } finally {
      setBuilding(false)
    }
  }

  return (
    <SlideOver onClose={onClose} open={open} title={isEdit ? 'Edit item' : 'Add item'}>
      <div className="px-5 py-5 space-y-4">
        {isVariant && item?.variant_label && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 text-xs font-medium">
            Variant · {item.variant_label}
          </div>
        )}

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

        {/* SKU + Barcode */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">SKU</label>
            <TextField
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              fullWidth
              size="small"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Barcode</label>
            <TextField
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              fullWidth
              size="small"
            />
          </div>
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

        {/* Variants — only for a non-variant item, edit mode only */}
        {isEdit && !isVariant && (
          <div className="mt-6 pt-5 border-t border-border-brand">
            <h3 className="text-sm font-semibold text-ink mb-1">Variants</h3>
            <p className="text-xs text-ink4 mb-3">
              e.g. sizes or colors — each variant tracks its own SKU and quantity.
            </p>
            {variants.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {variants.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between text-xs bg-bg rounded-lg px-3 py-2"
                  >
                    <span className="text-ink2">
                      {v.variant_label}
                      {v.sku && <span className="text-ink4 ml-1.5">({v.sku})</span>}
                    </span>
                    <span className="text-ink3 font-medium">{v.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <TextField
                value={newVariantLabel}
                onChange={(e) => setNewVariantLabel(e.target.value)}
                placeholder="Label (e.g. Large)"
                size="small"
              />
              <TextField
                value={newVariantSku}
                onChange={(e) => setNewVariantSku(e.target.value)}
                placeholder="SKU (optional)"
                size="small"
              />
              <TextField
                type="number"
                slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                value={newVariantQty}
                onChange={(e) => setNewVariantQty(e.target.value)}
                placeholder="Quantity"
                size="small"
              />
            </div>
            <Button
              onClick={() => void handleAddVariant()}
              disabled={addingVariant || !newVariantLabel.trim()}
              size="small"
              color="inherit"
            >
              {addingVariant ? 'Adding...' : '+ Add Variant'}
            </Button>
          </div>
        )}

        {/* Kit components — only for a non-variant item, edit mode only */}
        {isEdit && !isVariant && (
          <div className="mt-6 pt-5 border-t border-border-brand">
            <h3 className="text-sm font-semibold text-ink mb-1">Kit Components</h3>
            <p className="text-xs text-ink4 mb-3">
              Turn this item into a kit assembled from other items — e.g. a gift basket.
            </p>
            {kitComponents.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {kitComponents.map((c) => (
                  <li
                    key={c.component_item_id}
                    className="flex items-center gap-2 text-xs bg-bg rounded-lg px-3 py-2"
                  >
                    <span className="text-ink2 flex-1">
                      {c.component?.name ?? c.component_item_id}
                      {c.component?.sku && (
                        <span className="text-ink4 ml-1.5">({c.component.sku})</span>
                      )}
                    </span>
                    <TextField
                      type="number"
                      slotProps={{ htmlInput: { min: 1, step: 'any' } }}
                      value={c.quantity}
                      onChange={(e) =>
                        handleKitComponentQtyChange(c.component_item_id, Number(e.target.value))
                      }
                      onBlur={() => void saveKitComponents(kitComponents)}
                      size="small"
                      sx={{ width: 72 }}
                    />
                    <button
                      onClick={() => handleRemoveKitComponent(c.component_item_id)}
                      className="text-red-500 hover:text-red-600 text-sm shrink-0"
                      aria-label="Remove component"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="relative">
              <TextField
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search items to add as a component..."
                size="small"
                fullWidth
              />
              {itemSearchResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full bg-white border border-border-brand rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {itemSearchResults.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => handleAddKitComponent(r)}
                        className="w-full text-left px-3 py-2 text-xs text-ink2 hover:bg-bg"
                      >
                        {r.name} {r.sku && <span className="text-ink4">({r.sku})</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {savingKit && <p className="text-xs text-ink4 mt-1.5">Saving...</p>}

            {kitComponents.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border-brand">
                <p className="text-xs font-medium text-ink3 mb-2">Build kits from stock</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <TextField
                    type="number"
                    slotProps={{ htmlInput: { min: 1, step: 'any' } }}
                    value={buildQty}
                    onChange={(e) => setBuildQty(e.target.value)}
                    placeholder="Quantity to build"
                    size="small"
                  />
                  <TextField
                    value={buildReason}
                    onChange={(e) => setBuildReason(e.target.value)}
                    placeholder="Reason (optional)"
                    size="small"
                  />
                </div>
                <Button
                  onClick={() => void handleBuild()}
                  disabled={building}
                  size="small"
                  variant="contained"
                >
                  {building ? 'Building...' : 'Build Kit'}
                </Button>
                {buildToast && <p className="text-xs text-ink3 mt-2">{buildToast}</p>}
              </div>
            )}
          </div>
        )}

        {/* Movement ledger — edit mode only */}
        {isEdit && (
          <div className="mt-6 pt-5 border-t border-border-brand">
            <h3 className="text-sm font-semibold text-ink mb-3">Movement history</h3>
            {movementsLoading ? (
              <p className="text-xs text-ink4">Loading...</p>
            ) : movements.length === 0 ? (
              <p className="text-xs text-ink4">No adjustments recorded yet.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {movements.map((m) => (
                  <li key={m.id} className="text-xs flex items-start justify-between gap-2">
                    <span className="text-ink3">
                      {m.metadata.reason ?? m.body ?? 'Adjustment'}
                      <span className="text-ink4 ml-1.5">
                        {new Date(m.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </span>
                    <span
                      className={`font-medium shrink-0 ${
                        (m.metadata.delta ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {(m.metadata.delta ?? 0) > 0 ? '+' : ''}
                      {m.metadata.delta ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </SlideOver>
  )
}
