export interface Vendor {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  notes: string | null
  is_active: boolean
}

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'

export interface PurchaseOrderItem {
  id: string
  inventory_item_id: string | null
  description: string
  quantity_ordered: number
  quantity_received: number
  unit_cost: number
  total: number
}

export interface PurchaseOrder {
  id: string
  po_number: string
  vendor_id: string
  vendor_name?: string | null
  status: PoStatus
  expected_date: string | null
  notes: string | null
  subtotal: number
  created_at: string
  items?: PurchaseOrderItem[]
}

export const STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
}

export const STATUS_COLOR: Record<PoStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-50 text-blue-700',
  partial: 'bg-amber-50 text-amber-700',
  received: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
}
