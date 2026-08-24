'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Button from '@mui/material/Button'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import OrdersKanban from './OrdersKanban'
import OrdersList from './OrdersList'
import type { Order } from './types'

export default function OrdersBoard() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/orders?limit=100')
      if (res.ok) {
        const data = (await res.json()) as { data: Order[] }
        setOrders(data.data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const showToast = (msg: string, type: 'error' | 'success') => setToast({ msg, type })

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-teal-700'
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Orders</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {orders.length} order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_e, value: 'kanban' | 'list' | null) => value && setViewMode(value)}
            size="small"
          >
            <ToggleButton value="kanban">Board</ToggleButton>
            <ToggleButton value="list">List</ToggleButton>
          </ToggleButtonGroup>
          <Button component={Link} href="/orders/new" variant="contained">
            + New Order
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink4">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-ink4 mb-3">No orders yet.</p>
            <Button component={Link} href="/orders/new" variant="contained" size="small">
              Create your first order
            </Button>
          </div>
        </div>
      ) : viewMode === 'kanban' ? (
        <OrdersKanban orders={orders} setOrders={setOrders} showToast={showToast} />
      ) : (
        <OrdersList orders={orders} />
      )}
    </div>
  )
}
