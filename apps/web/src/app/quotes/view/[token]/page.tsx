'use client'

import { useState, useEffect } from 'react'

interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

interface QuoteData {
  quote_number: string
  title: string
  status: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  notes: string | null
  valid_until: string | null
  created_at: string
  business_name: string
  contacts: { full_name: string } | null
  line_items: LineItem[]
}

export default function PublicQuoteView({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [acted, setActed] = useState<'accepted' | 'declined' | null>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    params.then((p) => setToken(p.token))
  }, [params])

  useEffect(() => {
    if (!token) return
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    fetch(`${apiUrl}/api/quotes/view/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setQuote(data as QuoteData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function accept() {
    if (!token) return
    setActing(true)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    const res = await fetch(`${apiUrl}/api/quotes/view/${token}/accept`, { method: 'POST' })
    if (res.ok) setActed('accepted')
    setActing(false)
  }

  async function decline() {
    if (!token) return
    setActing(true)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    const res = await fetch(`${apiUrl}/api/quotes/view/${token}/decline`, { method: 'POST' })
    if (res.ok) setActed('declined')
    setActing(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading quote...</p>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Quote not found.</p>
      </div>
    )
  }

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date()
  const canAct = !acted && !isExpired && (quote.status === 'sent' || quote.status === 'viewed')

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900">{quote.business_name}</h1>
        </div>

        {/* Acted confirmation */}
        {acted && (
          <div
            className={`rounded-xl p-6 text-center mb-6 ${acted === 'accepted' ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-200'}`}
          >
            <p className="text-lg font-semibold text-gray-900 mb-1">
              {acted === 'accepted' ? 'Quote Accepted!' : 'Quote Declined'}
            </p>
            <p className="text-sm text-gray-500">
              {acted === 'accepted'
                ? `Thank you! ${quote.business_name} will be in touch.`
                : `${quote.business_name} has been notified.`}
            </p>
          </div>
        )}

        {/* Expired */}
        {isExpired && !acted && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center mb-6">
            <p className="text-sm font-medium text-amber-800">This quote has expired</p>
            <p className="text-xs text-amber-600 mt-1">
              Contact {quote.business_name} to request an updated quote.
            </p>
          </div>
        )}

        {/* Quote card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Quote</p>
                <p className="text-sm font-mono font-semibold text-gray-900">
                  {quote.quote_number}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Date</p>
                <p className="text-sm text-gray-700">
                  {new Date(quote.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
            {quote.contacts && (
              <p className="text-xs text-gray-400 mt-3">
                For: <span className="text-gray-700">{quote.contacts.full_name}</span>
              </p>
            )}
          </div>

          {/* Line items */}
          <div className="divide-y divide-gray-50">
            {quote.line_items.map((item, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm text-gray-700">{item.description}</p>
                  <p className="text-xs text-gray-400">
                    {item.quantity} &times; ${Number(item.unit_price).toFixed(2)}
                  </p>
                </div>
                <p className="text-sm font-medium text-gray-900">
                  ${Number(item.total).toFixed(2)}
                </p>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-gray-100 px-6 py-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span>${Number(quote.subtotal).toFixed(2)}</span>
            </div>
            {Number(quote.tax_rate) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax ({quote.tax_rate}%)</span>
                <span>${Number(quote.tax_amount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="text-teal-600">${Number(quote.total).toFixed(2)}</span>
            </div>
          </div>

          {quote.notes && (
            <div className="border-t border-gray-100 px-6 py-4">
              <p className="text-xs text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-600">{quote.notes}</p>
            </div>
          )}

          {quote.valid_until && !isExpired && (
            <div className="border-t border-gray-100 px-6 py-3">
              <p className="text-xs text-gray-400">
                Valid until{' '}
                {new Date(quote.valid_until).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        {canAct && (
          <div className="mt-6 space-y-3">
            <button
              onClick={accept}
              disabled={acting}
              className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {acting ? 'Processing...' : 'Accept Quote'}
            </button>
            <button
              onClick={decline}
              disabled={acting}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Decline
            </button>
          </div>
        )}

        <div className="text-center mt-6">
          <button
            onClick={() => {
              const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
              window.open(`${apiUrl}/api/quotes/view/${token}/pdf`, '_blank')
            }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Download PDF
          </button>
        </div>

        <p className="text-center text-[10px] text-gray-300 mt-4">Powered by Nuatis</p>
      </div>
    </div>
  )
}
