'use client'

import { useState, useEffect } from 'react'

interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

interface InvoiceData {
  invoice_number: string
  status: string
  issue_date: string
  due_date: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  amount_paid: number
  balance_due: number
  notes: string | null
  business_name: string
  contact_name: string | null
  line_items: LineItem[]
}

export default function PublicInvoiceView({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [justPaid, setJustPaid] = useState(false)

  useEffect(() => {
    params.then((p) => setToken(p.token))
  }, [params])

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paid')) {
      setJustPaid(true)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    fetch(`/api/invoices/public/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setInvoice(data as InvoiceData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function payNow() {
    if (!token) return
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch(`/api/invoices/public/${token}/pay`, { method: 'POST' })
      const data = (await res.json()) as { url?: string; error?: string }
      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        setPayError(data.error ?? 'Unable to start payment')
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Unable to start payment')
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink4">Loading invoice...</p>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink3">Invoice not found.</p>
      </div>
    )
  }

  const canPay = !justPaid && invoice.balance_due > 0 && invoice.status !== 'void'

  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <h1 className="text-lg font-bold text-ink">{invoice.business_name}</h1>
        </div>

        {justPaid && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-6 text-center mb-6">
            <p className="text-lg font-semibold text-green-800 mb-1">Thank you!</p>
            <p className="text-sm text-green-700">
              Your payment is being confirmed — this may take a moment to reflect below.
            </p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-border-brand shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border-brand">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink4">Invoice</p>
                <p className="text-sm font-mono font-semibold text-ink">{invoice.invoice_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink4">Issued</p>
                <p className="text-sm text-ink2">
                  {new Date(invoice.issue_date).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
              </div>
            </div>
            {invoice.contact_name && (
              <p className="text-xs text-ink4 mt-3">
                For: <span className="text-ink2">{invoice.contact_name}</span>
              </p>
            )}
          </div>

          <div className="divide-y divide-gray-50">
            {invoice.line_items.map((item, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-ink2">{item.description}</p>
                  <p className="text-xs text-ink4">
                    {item.quantity} &times; ${Number(item.unit_price).toFixed(2)}
                  </p>
                </div>
                <p className="text-sm font-medium text-ink">${Number(item.total).toFixed(2)}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-border-brand px-6 py-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-ink3">Subtotal</span>
              <span>${Number(invoice.subtotal).toFixed(2)}</span>
            </div>
            {Number(invoice.tax_rate) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ink3">Tax ({invoice.tax_rate}%)</span>
                <span>${Number(invoice.tax_amount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-2 border-t border-border-brand">
              <span>Total</span>
              <span className="text-teal-600">${Number(invoice.total).toFixed(2)}</span>
            </div>
            {Number(invoice.amount_paid) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ink3">Paid</span>
                <span className="text-green-600">-${Number(invoice.amount_paid).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-ink">Balance Due</span>
              <span className="text-ink">${Number(invoice.balance_due).toFixed(2)}</span>
            </div>
          </div>

          {invoice.notes && (
            <div className="border-t border-border-brand px-6 py-4">
              <p className="text-xs text-ink4 mb-1">Notes</p>
              <p className="text-sm text-ink3">{invoice.notes}</p>
            </div>
          )}

          {invoice.due_date && (
            <div className="border-t border-border-brand px-6 py-3">
              <p className="text-xs text-ink4">
                Due{' '}
                {new Date(invoice.due_date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </p>
            </div>
          )}
        </div>

        {canPay && (
          <div className="mt-6">
            {payError && <p className="text-xs text-rose-600 mb-3 text-center">{payError}</p>}
            <button
              onClick={() => void payNow()}
              disabled={paying}
              className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {paying ? 'Redirecting...' : `Pay $${Number(invoice.balance_due).toFixed(2)}`}
            </button>
          </div>
        )}

        {!canPay && !justPaid && invoice.balance_due <= 0 && (
          <div className="mt-6 bg-green-50 border border-green-100 rounded-xl p-4 text-center">
            <p className="text-sm font-medium text-green-800">Paid in full</p>
          </div>
        )}

        <p className="text-center text-[10px] text-gray-300 mt-6">Powered by Nuatis</p>
      </div>
    </div>
  )
}
