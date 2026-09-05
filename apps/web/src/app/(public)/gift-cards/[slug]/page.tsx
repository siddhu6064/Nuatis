'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const PRESET_AMOUNTS_CENTS = [2500, 5000, 10000, 15000]

export default function PublicGiftCardPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  const [amountCents, setAmountCents] = useState(5000)
  const [customAmount, setCustomAmount] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [balanceCode, setBalanceCode] = useState('')
  const [balanceResult, setBalanceResult] = useState<{
    balance_cents: number
    status: string
  } | null>(null)
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  useEffect(() => {
    if (customAmount.trim()) {
      const dollars = Number(customAmount)
      if (!Number.isNaN(dollars) && dollars > 0) setAmountCents(Math.round(dollars * 100))
    }
  }, [customAmount])

  async function handlePurchase(e: React.FormEvent) {
    e.preventDefault()
    if (!buyerName.trim() || (!buyerPhone.trim() && !buyerEmail.trim())) return
    setPurchasing(true)
    setError(null)
    try {
      const res = await fetch(`/api/gift-cards-public/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_cents: amountCents,
          recipient_name: recipientName.trim() || undefined,
          recipient_email: recipientEmail.trim() || undefined,
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim() || undefined,
          buyer_phone: buyerPhone.trim() || undefined,
        }),
      })
      const data = (await res.json()) as { payment_url?: string; error?: string }
      if (res.ok && data.payment_url) {
        window.location.href = data.payment_url
      } else {
        setError(data.error ?? 'Unable to start purchase')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start purchase')
    } finally {
      setPurchasing(false)
    }
  }

  async function handleBalanceCheck(e: React.FormEvent) {
    e.preventDefault()
    if (!balanceCode.trim()) return
    setCheckingBalance(true)
    setBalanceError(null)
    setBalanceResult(null)
    try {
      const res = await fetch(
        `/api/gift-cards-public/${slug}/balance/${encodeURIComponent(balanceCode.trim())}`
      )
      if (!res.ok) {
        setBalanceError('Gift card not found')
        return
      }
      const data = (await res.json()) as { balance_cents: number; status: string }
      setBalanceResult(data)
    } catch {
      setBalanceError('Unable to check balance')
    } finally {
      setCheckingBalance(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">Gift Cards</h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          Buy a gift card, or check the balance on one you already have.
        </p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Buy a gift card</h2>
          <form
            onSubmit={(e) => {
              void handlePurchase(e)
            }}
            className="space-y-4"
          >
            <div>
              <p className="text-xs text-gray-500 mb-2">Amount</p>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {PRESET_AMOUNTS_CENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setAmountCents(c)
                      setCustomAmount('')
                    }}
                    className={`py-2 rounded-lg text-sm font-medium border ${
                      amountCents === c && !customAmount
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200'
                    }`}
                  >
                    ${c / 100}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={5}
                max={1000}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Custom amount ($)"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Recipient name (optional — defaults to you)"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Recipient email (optional)"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />

            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Your info</p>
              <div className="space-y-3">
                <input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Your name"
                  required
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <input
                  type="tel"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="Phone"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <input
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={purchasing}
              className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {purchasing ? 'Redirecting…' : `Buy $${(amountCents / 100).toFixed(2)} Gift Card`}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Check a balance</h2>
          <form
            onSubmit={(e) => {
              void handleBalanceCheck(e)
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={balanceCode}
              onChange={(e) => setBalanceCode(e.target.value)}
              placeholder="Gift card code"
              className="flex-1 min-w-0 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={checkingBalance}
              className="shrink-0 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              Check
            </button>
          </form>
          {balanceError && <p className="text-xs text-rose-600 mt-3">{balanceError}</p>}
          {balanceResult && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold text-gray-900">
                ${(balanceResult.balance_cents / 100).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 capitalize">
                {balanceResult.status.replace(/_/g, ' ')}
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">Powered by Nuatis</p>
      </div>
    </div>
  )
}
