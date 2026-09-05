'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import { Modal } from '@/components/ui/Modal'
import InventorySlideOver, { type InventoryItem } from './InventorySlideOver'

interface Props {
  pageTitle: string
}

interface Location {
  id: string
  name: string
}

function qtyClass(qty: number, threshold: number): string {
  if (qty <= threshold) return 'bg-red-100 text-red-700'
  if (qty <= threshold * 2) return 'bg-amber-100 text-amber-700'
  return 'bg-green-100 text-green-700'
}

export default function InventoryList({ pageTitle }: Props) {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')

  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [slideOver, setSlideOver] = useState<{ open: boolean; item?: InventoryItem }>({
    open: false,
  })
  const [toast, setToast] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InventoryItem | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())

  const toggleCollapsed = (id: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchItems = useCallback(async (query: string, location: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (location) params.set('location_id', location)
      const res = await fetch(`/api/inventory?${params}`)
      if (res.ok) {
        const data = (await res.json()) as { data: InventoryItem[] }
        setItems(data.data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/locations')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { locations: Location[] } | null) => {
        if (data) setLocations(data.locations)
      })
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void fetchItems(q, locationId), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, locationId, fetchItems])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Cmd+K highlight flash — runs after items load
  useEffect(() => {
    if (!highlightId || items.length === 0) return
    const el = document.getElementById(`inv-row-${highlightId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashId(highlightId)
      const t = setTimeout(() => setFlashId(null), 2000)
      // Strip ?highlight from URL
      const url = new URL(window.location.href)
      url.searchParams.delete('highlight')
      window.history.replaceState({}, '', url.toString())
      return () => clearTimeout(t)
    }
    return undefined
  }, [highlightId, items])

  const onSaved = (saved: InventoryItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setToast(slideOver.item ? 'Item updated' : 'Item added')
    setSlideOver({ open: false })
  }

  // Group variants under their parent for nested rendering — only when the
  // parent is present in the current (possibly filtered/searched) result
  // set; a variant whose parent isn't loaded falls back to the flat
  // "Variant of X" subtitle exactly as before, same named limitation.
  const itemById = new Map(items.map((i) => [i.id, i]))
  const childrenByParent = new Map<string, InventoryItem[]>()
  for (const item of items) {
    if (item.parent_item_id && itemById.has(item.parent_item_id)) {
      const siblings = childrenByParent.get(item.parent_item_id) ?? []
      siblings.push(item)
      childrenByParent.set(item.parent_item_id, siblings)
    }
  }
  const rootItems = items.filter((i) => !i.parent_item_id || !itemById.has(i.parent_item_id))

  function renderRow(item: InventoryItem, isChild: boolean, childCount: number) {
    const qty = Number(item.quantity ?? 0)
    const thr = Number(item.reorder_threshold ?? 0)
    const flash = flashId === item.id
    // Only reached for an orphan variant rendered as a root row (its parent
    // isn't in the current, possibly filtered, result set) — a nested child
    // row never needs this since the parent-name is implied by nesting.
    const parentName =
      !isChild && item.parent_item_id ? (itemById.get(item.parent_item_id)?.name ?? null) : null

    return (
      <tr
        key={item.id}
        id={`inv-row-${item.id}`}
        className={`border-b border-gray-50 last:border-0 transition-colors ${
          flash ? 'bg-yellow-50' : 'hover:bg-gray-50/50'
        } ${isChild ? 'bg-gray-50/30' : ''}`}
      >
        <td className={`px-6 py-4 text-sm font-medium text-ink ${isChild ? 'pl-12' : ''}`}>
          <div className="flex items-center gap-1.5">
            {childCount > 0 && (
              <button
                type="button"
                onClick={() => toggleCollapsed(item.id)}
                aria-label={collapsedParents.has(item.id) ? 'Expand variants' : 'Collapse variants'}
                className="text-ink4 hover:text-ink text-xs w-4 shrink-0"
              >
                {collapsedParents.has(item.id) ? '▸' : '▾'}
              </button>
            )}
            {isChild && <span className="text-ink4 text-xs shrink-0">↳</span>}
            <span>{item.name}</span>
            {childCount > 0 && (
              <span className="text-xs font-normal text-ink4">
                ({childCount} variant{childCount === 1 ? '' : 's'})
              </span>
            )}
          </div>
          {(isChild || (item.parent_item_id && !itemById.has(item.parent_item_id))) && (
            <div className="text-xs font-normal text-ink4 mt-0.5 pl-5">
              {isChild
                ? item.variant_label || 'Variant'
                : `Variant${parentName ? ` of ${parentName}` : ''}${item.variant_label ? ` · ${item.variant_label}` : ''}`}
            </div>
          )}
        </td>
        <td className="px-6 py-4 text-sm text-ink3">{item.sku ?? '—'}</td>
        <td className="px-6 py-4 text-sm">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${qtyClass(qty, thr)}`}
          >
            {qty}
          </span>
        </td>
        <td className="px-6 py-4 text-sm text-ink3">{item.unit}</td>
        <td className="px-6 py-4 text-sm text-ink3">
          {item.unit_cost != null ? `$${Number(item.unit_cost).toFixed(2)}` : '—'}
        </td>
        <td className="px-6 py-4 text-sm text-ink3">{item.supplier ?? '—'}</td>
        <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
          <IconButton
            onClick={() => setSlideOver({ open: true, item })}
            size="small"
            aria-label="Edit"
            color="primary"
            sx={{ mr: 0.5 }}
          >
            ✎
          </IconButton>
          <IconButton
            onClick={() => setConfirmDelete(item)}
            size="small"
            aria-label="Delete"
            color="error"
          >
            ✕
          </IconButton>
        </td>
      </tr>
    )
  }

  const handleDelete = async (item: InventoryItem) => {
    const res = await fetch(`/api/inventory/${item.id}`, { method: 'DELETE' })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setToast('Item deleted')
    } else {
      setToast('Failed to delete')
    }
    setConfirmDelete(null)
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">{pageTitle}</h1>
          <p className="text-sm text-ink4 mt-0.5">
            Track stock, unit costs, and reorder thresholds
          </p>
        </div>
        <Button onClick={() => setSlideOver({ open: true })} variant="contained">
          + Add Item
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4 flex gap-2">
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or SKU..."
          size="small"
          sx={{ width: '100%', maxWidth: 384 }}
        />
        {locations.length > 0 && (
          <Select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            displayEmpty
            size="small"
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All locations</MenuItem>
            {locations.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </Select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-sm text-ink4">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm text-ink4">
              No {pageTitle.toLowerCase()} yet. Add your first item to track stock levels and get
              low-stock alerts.
            </p>
            <Button
              onClick={() => setSlideOver({ open: true })}
              variant="contained"
              size="small"
              sx={{ mt: 1.5 }}
            >
              Add your first item
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">SKU</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Quantity</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Unit</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Unit Cost</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Supplier</th>
                <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rootItems.flatMap((item) => {
                const children = childrenByParent.get(item.id) ?? []
                const collapsed = collapsedParents.has(item.id)
                const rows = [renderRow(item, false, children.length)]
                if (children.length > 0 && !collapsed) {
                  rows.push(...children.map((c) => renderRow(c, true, 0)))
                }
                return rows
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-over */}
      {slideOver.open && (
        <InventorySlideOver
          open={slideOver.open}
          onClose={() => setSlideOver({ open: false })}
          item={slideOver.item}
          onSaved={onSaved}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(null)}
          title="Delete item?"
          maxWidth="xs"
          footer={
            <>
              <Button onClick={() => setConfirmDelete(null)} variant="outlined" color="inherit">
                Cancel
              </Button>
              <Button
                onClick={() => void handleDelete(confirmDelete)}
                variant="contained"
                color="error"
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink3">
            Remove <strong>{confirmDelete.name}</strong>? This soft-deletes the record.
          </p>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
