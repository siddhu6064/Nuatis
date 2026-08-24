export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'ready'
  | 'completed'
  | 'cancelled'

export interface Order {
  id: string
  order_number: string
  status: OrderStatus
  source: 'staff' | 'maya'
  contact_id: string | null
  contacts: { full_name: string } | null
  customer_name: string | null
  customer_phone: string | null
  fulfillment_type: string | null
  assigned_staff_id: string | null
  staff_members: { name: string } | null
  deal_id: string | null
  source_quote_id: string | null
  subtotal: number
  tax_amount: number
  total: number
  payment_status: 'unpaid' | 'partial' | 'paid'
  amount_paid: number
  notes: string | null
  created_at: string
  error: string | null
  tracking_number: string | null
  tracking_carrier: string | null
  metadata: Record<string, unknown>
}

export interface OrderLineItem {
  id: string
  service_id: string | null
  inventory_item_id: string | null
  description: string
  quantity: number
  unit_price: number
  total: number
  notes: string | null
}

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'in_progress',
  'ready',
  'completed',
  'cancelled',
]

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
