'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'

interface Contact {
  id: string
  full_name: string
  phone: string | null
  email: string | null
}

interface Service {
  id: string
  name: string
  unit_price: number
  unit: string | null
  category: string | null
}

interface StaffMember {
  id: string
  name: string
}

interface Deal {
  id: string
  title: string
}

interface LineItem {
  key: string
  service_id: string | null
  description: string
  quantity: number
  unit_price: number
}

const FULFILLMENT_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'dine_in', label: 'Dine-in' },
]

export default function OrderBuilder({
  contacts,
  services,
  staff,
  deals,
}: {
  contacts: Contact[]
  services: Service[]
  staff: StaffMember[]
  deals: Deal[]
}) {
  const router = useRouter()
  const [contactId, setContactId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [taxRate, setTaxRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [fulfillmentType, setFulfillmentType] = useState('')
  const [requestedReadyTime, setRequestedReadyTime] = useState('')
  const [assignedStaffId, setAssignedStaffId] = useState('')
  const [dealId, setDealId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addFromCatalog(svc: Service) {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        service_id: svc.id,
        description: svc.name,
        quantity: 1,
        unit_price: Number(svc.unit_price),
      },
    ])
  }

  function addCustom() {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        service_id: null,
        description: '',
        quantity: 1,
        unit_price: 0,
      },
    ])
  }

  function updateItem(key: string, field: string, value: string | number) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, [field]: value } : i)))
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  async function save() {
    if (!contactId && !customerName.trim()) {
      setError('Select a contact or enter a customer name')
      return
    }
    if (items.length === 0) {
      setError('Add at least one line item')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId || null,
          customer_name: customerName.trim() || null,
          customer_phone: customerPhone.trim() || null,
          line_items: items.map((i) => ({
            service_id: i.service_id,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
          })),
          tax_rate: taxRate,
          notes: notes || null,
          fulfillment_type: fulfillmentType || null,
          requested_ready_time: requestedReadyTime || null,
          assigned_staff_id: assignedStaffId || null,
          deal_id: dealId || null,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error || 'Failed to create order')
        return
      }

      const order = await res.json()
      router.push(`/orders/${order.id}`)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-ink mb-6">New Order</h1>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Customer</h2>
            <TextField
              select
              label="Contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            >
              <MenuItem value="">— Walk-in / phone customer —</MenuItem>
              {contacts.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.full_name} {c.phone ? `(${c.phone})` : ''}
                </MenuItem>
              ))}
            </TextField>
            {!contactId && (
              <>
                <TextField
                  label="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  fullWidth
                  size="small"
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="Customer phone (optional)"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  fullWidth
                  size="small"
                />
              </>
            )}
          </div>

          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Assignment</h2>
            <TextField
              select
              label="Staff (optional)"
              value={assignedStaffId}
              onChange={(e) => setAssignedStaffId(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            >
              <MenuItem value="">— Unassigned —</MenuItem>
              {staff.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Deal (optional)"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              fullWidth
              size="small"
            >
              <MenuItem value="">— No linked deal —</MenuItem>
              {deals.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.title}
                </MenuItem>
              ))}
            </TextField>
          </div>

          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Fulfillment</h2>
            <TextField
              select
              label="Type"
              value={fulfillmentType}
              onChange={(e) => setFulfillmentType(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            >
              {FULFILLMENT_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Requested ready time (optional)"
              type="datetime-local"
              value={requestedReadyTime}
              onChange={(e) => setRequestedReadyTime(e.target.value)}
              fullWidth
              size="small"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </div>

          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Notes</h2>
            <TextField
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              rows={3}
              fullWidth
              size="small"
              placeholder="Special instructions..."
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Catalog</h2>
            <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
              {services.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => addFromCatalog(svc)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border border-border-brand hover:bg-bg transition-colors text-left"
                >
                  <span className="text-ink2">{svc.name}</span>
                  <span className="text-ink4 font-mono text-xs">
                    ${Number(svc.unit_price).toFixed(2)}
                  </span>
                </button>
              ))}
              {services.length === 0 && (
                <p className="text-xs text-ink4">No catalog items — add a custom line item.</p>
              )}
            </div>
            <Button onClick={addCustom} size="small" variant="outlined">
              + Custom item
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h2 className="text-sm font-semibold text-ink mb-3">Line items</h2>
            {items.length === 0 ? (
              <p className="text-xs text-ink4">No items yet — pick from the catalog.</p>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.key} className="flex items-start gap-2">
                    <TextField
                      value={item.description}
                      onChange={(e) => updateItem(item.key, 'description', e.target.value)}
                      placeholder="Description"
                      size="small"
                      sx={{ flex: 2 }}
                    />
                    <TextField
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, 'quantity', Number(e.target.value))}
                      size="small"
                      sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    />
                    <TextField
                      type="number"
                      value={item.unit_price}
                      onChange={(e) => updateItem(item.key, 'unit_price', Number(e.target.value))}
                      size="small"
                      sx={{ flex: 1 }}
                      slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                    />
                    <IconButton
                      onClick={() => removeItem(item.key)}
                      size="small"
                      aria-label="Remove"
                      color="error"
                    >
                      ✕
                    </IconButton>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border-brand mt-4 pt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-ink3">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink3">Tax rate (%)</span>
                <TextField
                  type="number"
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  size="small"
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                />
              </div>
              <div className="flex justify-between text-lg font-bold pt-1">
                <span>Total</span>
                <span className="text-teal-600">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button onClick={() => router.push('/orders')} variant="outlined" color="inherit">
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving} variant="contained">
              {saving ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
