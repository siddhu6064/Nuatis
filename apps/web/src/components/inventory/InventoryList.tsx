'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import InventorySlideOver, { type InventoryItem } from './InventorySlideOver'

interface Props {
  pageTitle: string
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchItems = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
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
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void fetchItems(q), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, fetchItems])

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
          <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Track stock, unit costs, and reorder thresholds
          </p>
        </div>
        <button
          onClick={() => setSlideOver({ open: true })}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Add Item
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or SKU..."
          className="w-full max-w-sm px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400">
              No {pageTitle.toLowerCase()} yet. Add your first item to track stock levels and get
              low-stock alerts.
            </p>
            <button
              onClick={() => setSlideOver({ open: true })}
              className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              Add your first item &rarr;
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">SKU</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Quantity</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Unit</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Unit Cost</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Supplier</th>
                <th className="text-right text-xs font-medium text-gray-400 px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const qty = Number(item.quantity ?? 0)
                const thr = Number(item.reorder_threshold ?? 0)
                const flash = flashId === item.id
                return (
                  <tr
                    key={item.id}
                    id={`inv-row-${item.id}`}
                    className={`border-b border-gray-50 last:border-0 transition-colors ${
                      flash ? 'bg-yellow-50' : 'hover:bg-gray-50/50'
                    }`}
                  >
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{item.sku ?? '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${qtyClass(qty, thr)}`}
                      >
                        {qty}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{item.unit}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {item.unit_cost != null ? `$${Number(item.unit_cost).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{item.supplier ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-right whitespace-nowrap">
                      <button
                        onClick={() => setSlideOver({ open: true, item })}
                        className="text-teal-600 hover:text-teal-700 mr-3"
                        aria-label="Edit"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => setConfirmDelete(item)}
                        className="text-red-500 hover:text-red-700"
                        aria-label="Delete"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
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
        <div className="fixed inset-0 z-[55] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Delete item?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Remove <strong>{confirmDelete.name}</strong>? This soft-deletes the record.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete(confirmDelete)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
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
