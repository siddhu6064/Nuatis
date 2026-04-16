'use client'

import { useState, useEffect, useCallback } from 'react'

interface PackageItem {
  service_id: string
  qty: number
}

interface Package {
  id: string
  vertical: string
  name: string
  description: string | null
  items: PackageItem[]
  bundle_price: number
  bundle_discount_pct: number | null
  is_active: boolean
  sort_order: number
}

interface Service {
  id: string
  name: string
  unit_price: number
}

const VERTICALS = [
  'dental',
  'salon',
  'contractor',
  'law_firm',
  'real_estate',
  'restaurant',
  'sales_crm',
]

const VERTICAL_LABELS: Record<string, string> = {
  dental: 'Dental',
  salon: 'Salon',
  contractor: 'Contractor',
  law_firm: 'Law Firm',
  real_estate: 'Real Estate',
  restaurant: 'Restaurant',
  sales_crm: 'Sales CRM',
}

export default function PackageManager() {
  const [packages, setPackages] = useState<Package[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Form state
  const [formVertical, setFormVertical] = useState('dental')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formBundlePrice, setFormBundlePrice] = useState(0)
  const [formItems, setFormItems] = useState<Array<{ service_id: string; qty: number }>>([])
  const [formSaving, setFormSaving] = useState(false)

  const fetchPackages = useCallback(async () => {
    const res = await fetch('/api/packages')
    if (res.ok) {
      const data = await res.json()
      setPackages(data.packages ?? [])
    }
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/packages').then((r) => (r.ok ? r.json() : { packages: [] })),
      fetch('/api/services').then((r) => (r.ok ? r.json() : { services: [] })),
    ])
      .then(([pkgData, svcData]) => {
        setPackages(pkgData.packages ?? [])
        setServices(svcData.services ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  function resetForm() {
    setFormVertical('dental')
    setFormName('')
    setFormDescription('')
    setFormBundlePrice(0)
    setFormItems([])
    setEditingId(null)
    setShowForm(false)
  }

  function openCreate() {
    resetForm()
    setShowForm(true)
  }

  function openEdit(pkg: Package) {
    setEditingId(pkg.id)
    setFormVertical(pkg.vertical)
    setFormName(pkg.name)
    setFormDescription(pkg.description ?? '')
    setFormBundlePrice(Number(pkg.bundle_price))
    setFormItems(pkg.items.map((i) => ({ ...i })))
    setShowForm(true)
  }

  function toggleServiceInForm(svcId: string) {
    setFormItems((prev) => {
      const exists = prev.find((i) => i.service_id === svcId)
      if (exists) return prev.filter((i) => i.service_id !== svcId)
      return [...prev, { service_id: svcId, qty: 1 }]
    })
  }

  function updateFormItemQty(svcId: string, qty: number) {
    setFormItems((prev) =>
      prev.map((i) => (i.service_id === svcId ? { ...i, qty: Math.max(1, qty) } : i))
    )
  }

  const listPriceTotal = formItems.reduce((sum, fi) => {
    const svc = services.find((s) => s.id === fi.service_id)
    return sum + fi.qty * (svc ? Number(svc.unit_price) : 0)
  }, 0)

  const computedDiscountPct =
    listPriceTotal > 0 && formBundlePrice > 0 && formBundlePrice < listPriceTotal
      ? Number((((listPriceTotal - formBundlePrice) / listPriceTotal) * 100).toFixed(1))
      : 0

  async function savePackage() {
    if (!formName.trim()) return
    if (formItems.length < 2) {
      showToast('error', 'Select at least 2 services')
      return
    }
    if (formBundlePrice <= 0) {
      showToast('error', 'Bundle price must be greater than 0')
      return
    }
    if (formBundlePrice >= listPriceTotal) {
      showToast('error', 'Bundle price must be less than list price')
      return
    }

    setFormSaving(true)
    const body = {
      vertical: formVertical,
      name: formName.trim(),
      description: formDescription.trim() || null,
      bundle_price: formBundlePrice,
      items: formItems,
    }

    const url = editingId ? `/api/packages/${editingId}` : '/api/packages'
    const method = editingId ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setFormSaving(false)

    if (res.ok) {
      showToast('success', editingId ? 'Package updated' : 'Package created')
      resetForm()
      await fetchPackages()
    } else {
      const d = await res.json().catch(() => ({}))
      showToast('error', d.error || 'Failed to save')
    }
  }

  async function deactivate(pkgId: string) {
    if (!confirm('Deactivate this package? It will no longer appear in quotes.')) return
    const res = await fetch(`/api/packages/${pkgId}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('success', 'Package deactivated')
      await fetchPackages()
    }
  }

  async function movePackage(pkgId: string, direction: 'up' | 'down') {
    const idx = packages.findIndex((p) => p.id === pkgId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= packages.length) return

    const updated = [...packages]
    const tmp = updated[idx]!.sort_order
    updated[idx]!.sort_order = updated[swapIdx]!.sort_order
    updated[swapIdx]!.sort_order = tmp

    setPackages([...updated].sort((a, b) => a.sort_order - b.sort_order))

    await fetch('/api/packages/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { id: updated[idx]!.id, sort_order: updated[idx]!.sort_order },
        { id: updated[swapIdx]!.id, sort_order: updated[swapIdx]!.sort_order },
      ]),
    })
  }

  // Group packages by vertical
  const grouped = packages.reduce<Record<string, Package[]>>((acc, pkg) => {
    const key = pkg.vertical
    if (!acc[key]) acc[key] = []
    acc[key].push(pkg)
    return acc
  }, {})

  if (loading) return <p className="text-sm text-gray-400">Loading packages...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{packages.length} active packages</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          + New Package
        </button>
      </div>

      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
        >
          {toast.msg}
        </p>
      )}

      {/* Package list grouped by vertical */}
      {Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-sm text-gray-400">No packages yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Create bundled service packages to offer discounted pricing
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([vertical, pkgs]) => (
          <div key={vertical}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {VERTICAL_LABELS[vertical] ?? vertical}
            </h3>
            <div className="space-y-2">
              {pkgs.map((pkg, idx) => (
                <div
                  key={pkg.id}
                  className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{pkg.name}</p>
                      {pkg.bundle_discount_pct != null && Number(pkg.bundle_discount_pct) > 0 && (
                        <span className="text-[10px] font-medium bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                          {Number(pkg.bundle_discount_pct).toFixed(0)}% off
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(pkg.items as PackageItem[]).length} services &middot;{' '}
                      <span className="font-medium text-gray-600">
                        ${Number(pkg.bundle_price).toFixed(2)}
                      </span>
                    </p>
                    {pkg.description && (
                      <p className="text-xs text-gray-400 mt-0.5">{pkg.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <button
                      onClick={() => movePackage(pkg.id, 'up')}
                      disabled={idx === 0}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30 p-1 text-xs"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => movePackage(pkg.id, 'down')}
                      disabled={idx === pkgs.length - 1}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30 p-1 text-xs"
                      title="Move down"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => openEdit(pkg)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deactivate(pkg.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Create/Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 pt-20 overflow-y-auto">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl mb-20">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              {editingId ? 'Edit Package' : 'New Package'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Vertical</label>
                <select
                  value={formVertical}
                  onChange={(e) => setFormVertical(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>
                      {VERTICAL_LABELS[v] ?? v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. New Patient Package"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Service picker */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Services ({formItems.length} selected)
                </label>
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                  {services.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">No services found</p>
                  ) : (
                    services.map((svc) => {
                      const selected = formItems.find((i) => i.service_id === svc.id)
                      return (
                        <div
                          key={svc.id}
                          className={`flex items-center justify-between px-3 py-2 border-b border-gray-50 last:border-0 ${selected ? 'bg-teal-50' : ''}`}
                        >
                          <label className="flex items-center gap-2 text-sm cursor-pointer flex-1">
                            <input
                              type="checkbox"
                              checked={!!selected}
                              onChange={() => toggleServiceInForm(svc.id)}
                              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                            />
                            <span className="text-gray-700">{svc.name}</span>
                            <span className="text-gray-400 ml-auto">
                              ${Number(svc.unit_price).toFixed(2)}
                            </span>
                          </label>
                          {selected && (
                            <input
                              type="number"
                              value={selected.qty}
                              onChange={(e) =>
                                updateFormItemQty(svc.id, parseInt(e.target.value) || 1)
                              }
                              className="w-14 px-2 py-1 text-xs border border-gray-200 rounded ml-2 text-center"
                              min="1"
                            />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
                {listPriceTotal > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    List price total: ${listPriceTotal.toFixed(2)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Bundle Price</label>
                <input
                  type="number"
                  value={formBundlePrice}
                  onChange={(e) => setFormBundlePrice(parseFloat(e.target.value) || 0)}
                  className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  min="0"
                  step="0.01"
                />
                {computedDiscountPct > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    You&apos;re saving customers {computedDiscountPct}% ($
                    {(listPriceTotal - formBundlePrice).toFixed(2)} off)
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-6 justify-end">
              <button
                onClick={resetForm}
                className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={savePackage}
                disabled={formSaving}
                className="text-xs text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                {formSaving ? 'Saving...' : editingId ? 'Update Package' : 'Create Package'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
