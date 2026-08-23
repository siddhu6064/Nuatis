'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'

interface LineItem {
  key: string
  description: string
  quantity: number
  unit_price: number
}

interface ContactResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

export default function InvoiceBuilder() {
  const router = useRouter()

  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { key: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0 },
  ])

  const [contactSearch, setContactSearch] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactName, setContactName] = useState('')
  const [contactResults, setContactResults] = useState<ContactResult[]>([])
  const [contactDropOpen, setContactDropOpen] = useState(false)
  const contactSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleContactInput(val: string) {
    setContactSearch(val)
    setContactDropOpen(true)
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current)
    if (!val.trim()) {
      setContactResults([])
      return
    }
    contactSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(val)}&limit=8`)
        if (!res.ok) return
        const data = (await res.json()) as { contacts?: ContactResult[] }
        setContactResults(data.contacts ?? [])
      } catch {
        // ignore
      }
    }, 300)
  }

  function selectContact(c: ContactResult) {
    setContactId(c.id)
    setContactName(c.full_name)
    setContactSearch(c.full_name)
    setContactResults([])
    setContactDropOpen(false)
  }

  function updateLineItem(key: string, field: keyof LineItem, value: string | number) {
    setLineItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    )
  }

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0 },
    ])
  }

  function removeLineItem(key: string) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((i) => i.key !== key) : prev))
  }

  const subtotal = lineItems.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0)
  const taxAmount = (subtotal * taxRate) / 100
  const total = subtotal + taxAmount

  async function save() {
    const items = lineItems.filter((i) => i.description.trim())
    if (items.length === 0) {
      setError('Add at least one line item')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          issue_date: issueDate || null,
          due_date: dueDate || null,
          notes: notes || null,
          tax_rate: taxRate,
          line_items: items.map((i) => ({
            description: i.description,
            quantity: Number(i.quantity),
            unit_price: Number(i.unit_price),
          })),
        }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to create invoice')
        return
      }
      const invoice = (await res.json()) as { id: string }
      router.push(`/invoices/${invoice.id}`)
    } catch {
      setError('Failed to create invoice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-ink mb-6">New Invoice</h1>

      <div className="space-y-6">
        {/* Dates + Contact */}
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink4 mb-1">Issue Date</label>
              <TextField
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                fullWidth
                size="small"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink4 mb-1">Due Date</label>
              <TextField
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                fullWidth
                size="small"
              />
            </div>
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-ink4 mb-1">Contact</label>
            <TextField
              value={contactSearch}
              onChange={(e) => handleContactInput(e.target.value)}
              onFocus={() => {
                if (contactSearch) setContactDropOpen(true)
              }}
              onBlur={() => setTimeout(() => setContactDropOpen(false), 150)}
              placeholder="Search contacts…"
              fullWidth
              size="small"
            />
            {contactDropOpen && contactResults.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-border-brand rounded-lg shadow-lg mt-1 max-h-48 overflow-auto">
                <MenuList disablePadding>
                  {contactResults.map((c) => (
                    <MenuItem
                      key={c.id}
                      onMouseDown={() => selectContact(c)}
                      sx={{ fontSize: 14, py: 1.25, px: 1.5, whiteSpace: 'normal' }}
                    >
                      <span className="font-medium text-ink">{c.full_name}</span>
                      {c.email && <span className="text-ink4 ml-2 text-xs">{c.email}</span>}
                    </MenuItem>
                  ))}
                </MenuList>
              </div>
            )}
            {contactId && contactName && (
              <p className="text-xs text-ink4 mt-1">
                Selected: <span className="text-ink3 font-medium">{contactName}</span>
                <IconButton
                  onClick={() => {
                    setContactId(null)
                    setContactName('')
                    setContactSearch('')
                  }}
                  size="small"
                  sx={{ color: '#f87171', '&:hover': { color: '#dc2626' } }}
                >
                  ×
                </IconButton>
              </p>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl border border-border-brand">
          <div className="px-6 pt-5 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Line Items</h2>
            <Button onClick={addLineItem} size="small" variant="outlined" sx={{ fontSize: 12 }}>
              + Add Line Item
            </Button>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-y border-border-brand bg-bg/40">
                <th className="text-left text-xs font-medium text-ink4 px-4 py-2.5">Description</th>
                <th className="text-right text-xs font-medium text-ink4 px-3 py-2.5 w-20">Qty</th>
                <th className="text-right text-xs font-medium text-ink4 px-3 py-2.5 w-28">
                  Unit Price
                </th>
                <th className="text-right text-xs font-medium text-ink4 px-4 py-2.5 w-24">
                  Amount
                </th>
                <th className="w-10 px-2" />
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => {
                const amount = Number(item.quantity) * Number(item.unit_price)
                return (
                  <tr key={item.key} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2">
                      <TextField
                        value={item.description}
                        onChange={(e) => updateLineItem(item.key, 'description', e.target.value)}
                        placeholder="Item description"
                        fullWidth
                        size="small"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TextField
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(item.key, 'quantity', parseFloat(e.target.value) || 0)
                        }
                        fullWidth
                        size="small"
                        slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TextField
                        type="number"
                        value={item.unit_price}
                        onChange={(e) =>
                          updateLineItem(item.key, 'unit_price', parseFloat(e.target.value) || 0)
                        }
                        fullWidth
                        size="small"
                        slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                      />
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-medium text-ink">
                      ${amount.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <IconButton
                        onClick={() => removeLineItem(item.key)}
                        size="small"
                        title="Remove line item"
                        sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                      >
                        ×
                      </IconButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div className="border-t border-border-brand px-6 py-4">
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink3">Subtotal</span>
                  <span className="text-ink">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-ink3 flex items-center gap-1">
                    Tax
                    <TextField
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                      size="small"
                      sx={{ width: 64 }}
                      slotProps={{
                        htmlInput: {
                          min: 0,
                          max: 100,
                          step: 0.5,
                          style: { textAlign: 'right', fontSize: 12 },
                        },
                      }}
                    />
                    %
                  </span>
                  <span className="text-ink">${taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-border-brand pt-1.5">
                  <span className="font-semibold text-ink">Total</span>
                  <span className="font-semibold text-teal-600">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl border border-border-brand p-6">
          <label className="block text-sm font-semibold text-ink mb-2">Notes</label>
          <TextField
            multiline
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes for the invoice…"
            fullWidth
            size="small"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving} variant="contained">
            {saving ? 'Saving…' : 'Save as Draft'}
          </Button>
        </div>
      </div>
    </div>
  )
}
