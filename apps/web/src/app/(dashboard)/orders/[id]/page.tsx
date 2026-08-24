import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import OrderStatusControl from './OrderStatusControl'
import OrderPayments from './OrderPayments'
import OrderStaffControl from './OrderStaffControl'
import OrderErrorBanner from './OrderErrorBanner'
import OrderTrackingControl from './OrderTrackingControl'

interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  total: number
}

interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  recorded_at: string
}

interface OrderRecord {
  id: string
  order_number: string
  status: string
  source: string
  customer_name: string | null
  customer_phone: string | null
  fulfillment_type: string | null
  requested_ready_time: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  payment_status: string
  amount_paid: number
  balance_due: number
  notes: string | null
  confirmed_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  contacts: { full_name: string; phone: string | null; email: string | null } | null
  assigned_staff_id: string | null
  staff_members: { name: string } | null
  deal_id: string | null
  deals: { title: string } | null
  source_quote_id: string | null
  quotes: { quote_number: string } | null
  error: string | null
  tracking_number: string | null
  tracking_carrier: string | null
}

interface StaffOption {
  id: string
  name: string
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-bg2', text: 'text-ink3', label: 'Pending' },
  confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Confirmed' },
  in_progress: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'In Progress' },
  ready: { bg: 'bg-teal-50', text: 'text-teal-700', label: 'Ready' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', label: 'Completed' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600', label: 'Cancelled' },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      '*, contacts(full_name, phone, email), staff_members(name), deals(title), quotes(quote_number)'
    )
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single<OrderRecord>()

  if (!order) notFound()

  const { data: staffOptions } = await supabase
    .from('staff_members')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .returns<StaffOption[]>()

  const { data: items } = await supabase
    .from('order_line_items')
    .select('id, description, quantity, unit_price, total')
    .eq('order_id', id)
    .order('sort_order', { ascending: true })
    .returns<LineItem[]>()

  const { data: payments } = await supabase
    .from('order_payments')
    .select('id, amount, method, reference, notes, recorded_at')
    .eq('order_id', id)
    .order('recorded_at', { ascending: false })
    .returns<Payment[]>()

  const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE['pending']!

  return (
    <div className="px-8 py-8 max-w-3xl">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1 text-sm text-ink4 hover:text-ink3 mb-6"
      >
        &larr; Back to Orders
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink">{order.order_number}</h1>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
            >
              {badge.label}
            </span>
            {order.source === 'maya' && (
              <span className="text-xs text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded">
                Placed by Maya
              </span>
            )}
          </div>
          <p className="text-sm text-ink3 mt-1">
            {order.contacts?.full_name ?? order.customer_name ?? 'Walk-in'}
            {(order.contacts?.phone ?? order.customer_phone) &&
              ` · ${order.contacts?.phone ?? order.customer_phone}`}
          </p>
        </div>
        <OrderStatusControl orderId={order.id} status={order.status} />
      </div>

      {order.cancel_reason && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-800">Cancelled: {order.cancel_reason}</p>
        </div>
      )}

      <OrderErrorBanner orderId={order.id} initialError={order.error} />

      {order.fulfillment_type === 'delivery' && (
        <OrderTrackingControl
          orderId={order.id}
          initialTrackingNumber={order.tracking_number}
          initialTrackingCarrier={order.tracking_carrier}
        />
      )}

      {order.fulfillment_type && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-6">
          <p className="text-sm font-medium text-ink capitalize">
            {order.fulfillment_type.replace('_', ' ')}
          </p>
          {order.requested_ready_time && (
            <p className="text-xs text-ink4 mt-1">
              Requested for{' '}
              {new Date(order.requested_ready_time).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand p-4 mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-sm">
          {order.deals && (
            <span className="text-ink3">
              Deal:{' '}
              <Link href={`/pipeline`} className="text-teal-700 hover:underline">
                {order.deals.title}
              </Link>
            </span>
          )}
          {order.quotes && order.source_quote_id && (
            <span className="text-ink3">
              From quote:{' '}
              <Link
                href={`/quotes/${order.source_quote_id}`}
                className="text-teal-700 hover:underline"
              >
                {order.quotes.quote_number}
              </Link>
            </span>
          )}
        </div>
        <OrderStaffControl
          orderId={order.id}
          staff={staffOptions ?? []}
          initialStaffId={order.assigned_staff_id}
          initialStaffName={order.staff_members?.name ?? null}
        />
      </div>

      <div className="bg-white rounded-xl border border-border-brand mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-brand">
              <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Description</th>
              <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Qty</th>
              <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Price</th>
              <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id} className="border-b border-gray-50 last:border-0">
                <td className="px-6 py-3 text-sm text-ink2">{item.description}</td>
                <td className="px-6 py-3 text-sm text-ink3 text-right">{item.quantity}</td>
                <td className="px-6 py-3 text-sm text-ink3 text-right">
                  ${Number(item.unit_price).toFixed(2)}
                </td>
                <td className="px-6 py-3 text-sm text-ink text-right font-medium">
                  ${Number(item.total).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border-brand px-6 py-4">
          <div className="flex justify-end">
            <div className="w-56 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-ink3">Subtotal</span>
                <span>${Number(order.subtotal).toFixed(2)}</span>
              </div>
              {Number(order.tax_rate) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-ink3">Tax ({order.tax_rate}%)</span>
                  <span>${Number(order.tax_amount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t border-border-brand pt-1">
                <span>Total</span>
                <span className="text-teal-600">${Number(order.total).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <OrderPayments
        orderId={order.id}
        orderTotal={Number(order.total)}
        initialPayments={payments ?? []}
        initialPaymentStatus={order.payment_status}
        initialAmountPaid={Number(order.amount_paid)}
      />

      {order.notes && (
        <div className="bg-white rounded-xl border border-border-brand p-6 mb-6">
          <h2 className="text-sm font-semibold text-ink mb-2">Notes</h2>
          <p className="text-sm text-ink3">{order.notes}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-3">Activity</h2>
        <div className="space-y-2 text-xs text-ink3">
          <p>
            Created:{' '}
            {new Date(order.created_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
          {order.confirmed_at && (
            <p>
              Confirmed:{' '}
              {new Date(order.confirmed_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {order.completed_at && (
            <p className="text-green-600">
              Completed:{' '}
              {new Date(order.completed_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {order.cancelled_at && (
            <p className="text-red-600">
              Cancelled:{' '}
              {new Date(order.cancelled_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
