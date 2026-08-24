'use client'

import Link from 'next/link'
import { formatCurrency } from '@nuatis/shared'
import { STATUS_LABELS, type Order } from './types'

interface Props {
  orders: Order[]
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-bg2 text-ink3',
  confirmed: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-amber-50 text-amber-700',
  ready: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
}

export default function OrdersList({ orders }: Props) {
  return (
    <div className="bg-white rounded-xl border border-border-brand overflow-hidden flex-1 overflow-y-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-brand sticky top-0 bg-white">
            <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Order</th>
            <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Customer</th>
            <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Status</th>
            <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Staff</th>
            <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Payment</th>
            <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Total</th>
            <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
            >
              <td className="px-6 py-4 text-sm font-medium text-ink">
                <Link href={`/orders/${order.id}`} className="hover:text-teal-700">
                  {order.order_number}
                </Link>
                {order.source === 'maya' && (
                  <span className="ml-2 font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide bg-teal-50 text-teal-600">
                    MAYA
                  </span>
                )}
                {order.error && (
                  <span
                    className="ml-2 text-xs"
                    title={order.error}
                    aria-label="Order has an error"
                  >
                    ⚠
                  </span>
                )}
              </td>
              <td className="px-6 py-4 text-sm text-ink3">
                {order.contacts?.full_name ?? order.customer_name ?? 'Walk-in'}
              </td>
              <td className="px-6 py-4 text-sm">
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    STATUS_BADGE[order.status] ?? STATUS_BADGE['pending']
                  }`}
                >
                  {STATUS_LABELS[order.status]}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-ink3">{order.staff_members?.name ?? '—'}</td>
              <td className="px-6 py-4 text-sm text-ink3 capitalize">{order.payment_status}</td>
              <td className="px-6 py-4 text-sm text-ink text-right font-medium">
                {formatCurrency(Number(order.total))}
              </td>
              <td className="px-6 py-4 text-sm text-ink4 text-right">
                {new Date(order.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
