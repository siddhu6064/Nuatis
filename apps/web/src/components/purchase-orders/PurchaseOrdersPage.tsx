'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import POCreateSlideOver from './POCreateSlideOver'
import PODetail from './PODetail'
import VendorsList from './VendorsList'
import { STATUS_LABEL, STATUS_COLOR, type PurchaseOrder, type Vendor } from './types'

type Tab = 'orders' | 'vendors'

export default function PurchaseOrdersPage() {
  const [tab, setTab] = useState<Tab>('orders')
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const loadPos = useCallback(() => {
    fetch('/api/purchase-orders')
      .then((r) => r.json())
      .then((res: { data: PurchaseOrder[] }) => setPos(res.data))
  }, [])

  const loadVendors = useCallback(() => {
    fetch('/api/vendors')
      .then((r) => r.json())
      .then((res: { data: Vendor[] }) => setVendors(res.data))
  }, [])

  useEffect(() => {
    loadPos()
    loadVendors()
  }, [loadPos, loadVendors])

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Purchase Orders</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Order stock from vendors and receive it into inventory.
          </p>
        </div>
        {tab === 'orders' && (
          <Button
            onClick={() => setCreateOpen(true)}
            variant="contained"
            disabled={vendors.length === 0}
          >
            + New purchase order
          </Button>
        )}
      </div>

      <div className="flex gap-1 mb-5 border-b border-border-brand">
        {(['orders', 'vendors'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-ink3'
            }`}
          >
            {t === 'orders' ? 'Purchase Orders' : 'Vendors'}
          </button>
        ))}
      </div>

      {vendors.length === 0 && tab === 'orders' && (
        <p className="text-sm text-ink3 mb-4">
          Add a vendor first (Vendors tab) before creating a purchase order.
        </p>
      )}

      {tab === 'orders' ? (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">PO #</th>
                <th className="text-left px-4 py-2">Vendor</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Subtotal</th>
                <th className="text-left px-4 py-2">Expected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-brand">
              {pos === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    Loading…
                  </td>
                </tr>
              ) : pos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    No purchase orders yet.
                  </td>
                </tr>
              ) : (
                pos.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => setDetailId(po.id)}
                    className="cursor-pointer hover:bg-bg2"
                  >
                    <td className="px-4 py-2.5 text-ink font-medium">{po.po_number}</td>
                    <td className="px-4 py-2.5 text-ink3">{po.vendor_name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[po.status]}`}
                      >
                        {STATUS_LABEL[po.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink tabular-nums">
                      ${po.subtotal.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-ink3">{po.expected_date ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <VendorsList vendors={vendors} onChanged={loadVendors} />
      )}

      <POCreateSlideOver
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        vendors={vendors}
        onCreated={() => {
          setCreateOpen(false)
          loadPos()
        }}
      />

      <PODetail
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        poId={detailId}
        onUpdated={loadPos}
      />
    </div>
  )
}
