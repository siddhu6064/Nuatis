'use client'

import { useState, useEffect, useRef } from 'react'

interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
  package_id: string | null
}

interface SquareInfo {
  app_id: string
  location_id: string
}

interface QuoteData {
  quote_number: string
  title: string
  status: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  discount_type: string | null
  discount_amount: number | null
  discount_label: string | null
  deposit_pct: number | null
  deposit_amount: number | null
  remaining_balance: number | null
  notes: string | null
  valid_until: string | null
  created_at: string
  business_name: string
  contacts: { full_name: string; email?: string | null } | null
  line_items: LineItem[]
  square_info: SquareInfo | null
  requires_signature: boolean
  signature_status: 'none' | 'waiting' | 'signed' | 'declined'
  signed_by_name: string | null
  signed_at: string | null
}

export default function PublicQuoteView({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null)
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [acted, setActed] = useState<'accepted' | 'declined' | 'signed' | null>(null)
  const [acting, setActing] = useState(false)

  // Square payment state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [squareCard, setSquareCard] = useState<any>(null)
  const [payTab, setPayTab] = useState<'square' | 'other'>('square')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [paymentComplete, setPaymentComplete] = useState<string | null>(null) // receipt_url

  // Signature state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  useEffect(() => {
    params.then((p) => setToken(p.token))
  }, [params])

  useEffect(() => {
    if (!token) return
    fetch(`/api/quotes/view/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setQuote(data as QuoteData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  // Load Square Web Payments SDK when square_info is present
  useEffect(() => {
    if (!quote?.square_info) return

    const scriptSrc =
      process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js'

    // Avoid double-loading if script already present
    if (document.querySelector(`script[src="${scriptSrc}"]`)) {
      if ((window as unknown as { Square?: unknown }).Square) {
        void initSquareForm(quote.square_info)
      }
      return
    }

    const script = document.createElement('script')
    script.src = scriptSrc
    script.async = true
    script.onload = () => void initSquareForm(quote.square_info!)
    document.head.appendChild(script)
  }, [quote?.square_info])

  async function initSquareForm(squareInfo: SquareInfo) {
    try {
      const Square = (
        window as unknown as {
          Square: {
            payments: (
              appId: string,
              locationId: string
            ) => Promise<{ card: () => Promise<{ attach: (selector: string) => Promise<void> }> }>
          }
        }
      ).Square
      const payments = await Square.payments(squareInfo.app_id, squareInfo.location_id)
      const card = await payments.card()
      await card.attach('#square-card-container')
      setSquareCard(card)
    } catch (err) {
      console.error('[square] init error:', err)
    }
  }

  async function payWithSquare() {
    if (!squareCard || !token || !quote) return
    setPaying(true)
    setPayError(null)
    try {
      const tokenizeResult = await squareCard.tokenize()
      if (tokenizeResult.status !== 'OK') {
        setPayError('Card tokenization failed. Please check your card details.')
        return
      }
      const depositCents =
        quote.deposit_amount != null
          ? Math.round(Number(quote.deposit_amount) * 100)
          : Math.round(Number(quote.total) * 100)

      const res = await fetch(`/api/quotes/view/${token}/pay-square`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: tokenizeResult.token, amountCents: depositCents }),
      })
      const data = (await res.json()) as { receipt_url?: string; error?: string }
      if (res.ok) {
        setPaymentComplete(data.receipt_url ?? '')
      } else {
        setPayError(data.error ?? 'Payment failed')
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPaying(false)
    }
  }

  // Setup canvas on mount / when signature section becomes visible
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [quote?.requires_signature, quote?.signature_status])

  function getCanvasPos(
    e: MouseEvent | React.MouseEvent | Touch | { clientX: number; clientY: number },
    canvas: HTMLCanvasElement
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'clientX' in e ? e.clientX : (e as Touch).clientX
    const clientY = 'clientY' in e ? e.clientY : (e as Touch).clientY
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    drawing.current = true
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getCanvasPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getCanvasPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasStrokes(true)
  }

  function handleCanvasMouseUp() {
    drawing.current = false
  }

  function handleCanvasTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    drawing.current = true
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const touch = e.touches[0]
    if (!touch) return
    const pos = getCanvasPos(touch, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  function handleCanvasTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const touch = e.touches[0]
    if (!touch) return
    const pos = getCanvasPos(touch, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    setHasStrokes(true)
  }

  function handleCanvasTouchEnd() {
    drawing.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
  }

  function getSignatureData(): string {
    return canvasRef.current?.toDataURL('image/png') ?? ''
  }

  async function handleSign() {
    const signatureData = getSignatureData()
    if (!signatureData || !hasStrokes || !signerName.trim() || !token) return

    const sizeKB = Math.round((signatureData.length * 3) / 4 / 1024)
    if (sizeKB > 400) {
      setSignError('Signature image is too large. Please clear and sign again.')
      return
    }

    setSigning(true)
    setSignError(null)
    try {
      const res = await fetch(`/api/quotes/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature_data: signatureData,
          signed_by_name: signerName.trim(),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? 'Signature failed')
      }
      setActed('signed')
    } catch (e) {
      setSignError(e instanceof Error ? e.message : 'Signature failed')
    } finally {
      setSigning(false)
    }
  }

  async function accept() {
    if (!token) return
    setActing(true)
    const res = await fetch(`/api/quotes/view/${token}/accept`, { method: 'POST' })
    if (res.ok) setActed('accepted')
    setActing(false)
  }

  async function decline() {
    if (!token) return
    setActing(true)
    const res = await fetch(`/api/quotes/view/${token}/decline`, { method: 'POST' })
    if (res.ok) setActed('declined')
    setActing(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink4">Loading quote...</p>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink3">Quote not found.</p>
      </div>
    )
  }

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date()
  const canAct = !acted && !isExpired && (quote.status === 'sent' || quote.status === 'viewed')

  // Signature pad is shown when requires_signature && status is 'waiting' and not yet acted
  const showSignaturePad =
    canAct &&
    quote.requires_signature &&
    (quote.signature_status === 'waiting' || quote.signature_status === 'none')
  const alreadySigned = !acted && quote.requires_signature && quote.signature_status === 'signed'

  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <h1 className="text-lg font-bold text-ink">{quote.business_name}</h1>
        </div>

        {/* Acted confirmation */}
        {acted && (
          <div
            className={`rounded-xl p-6 text-center mb-6 ${acted === 'declined' ? 'bg-bg border border-border-brand' : 'bg-green-50 border border-green-100'}`}
          >
            <p className="text-lg font-semibold text-ink mb-1">
              {acted === 'signed'
                ? 'Proposal Signed!'
                : acted === 'accepted'
                  ? 'Quote Accepted!'
                  : 'Quote Declined'}
            </p>
            <p className="text-sm text-green-700">
              {acted === 'signed'
                ? `✓ Signed by ${signerName}. ${quote.business_name} has been notified.`
                : acted === 'accepted'
                  ? `✓ Quote accepted. A receipt has been sent to ${quote.contacts?.email ?? 'your email'}.`
                  : `${quote.business_name} has been notified.`}
            </p>
          </div>
        )}

        {/* Already signed (loaded from DB) */}
        {!acted && quote.requires_signature && quote.signature_status === 'signed' && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-6 text-center mb-6">
            <p className="text-lg font-semibold text-green-800 mb-1">Proposal Signed</p>
            <p className="text-sm text-green-700">
              ✓ Signed by {quote.signed_by_name}
              {quote.signed_at
                ? ` on ${new Date(quote.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                : ''}
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
        <div className="bg-white rounded-xl border border-border-brand shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border-brand">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink4">Quote</p>
                <p className="text-sm font-mono font-semibold text-ink">{quote.quote_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink4">Date</p>
                <p className="text-sm text-ink2">
                  {new Date(quote.created_at).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
            {quote.contacts && (
              <p className="text-xs text-ink4 mt-3">
                For: <span className="text-ink2">{quote.contacts.full_name}</span>
              </p>
            )}
          </div>

          {/* Line items with package grouping */}
          <div className="divide-y divide-gray-50">
            {(() => {
              const rendered: React.ReactNode[] = []
              const renderedPkgIds = new Set<string>()

              for (let i = 0; i < quote.line_items.length; i++) {
                const item = quote.line_items[i]!
                if (item.package_id && !renderedPkgIds.has(item.package_id)) {
                  renderedPkgIds.add(item.package_id)
                  const group = quote.line_items.filter((li) => li.package_id === item.package_id)
                  const discountRow = group.find((li) => Number(li.unit_price) < 0)
                  const serviceRows = group.filter((li) => Number(li.unit_price) >= 0)
                  const pkgName =
                    discountRow?.description?.replace(' — Bundle Savings', '') ?? 'Package'
                  const bundleTotal = group.reduce((s, li) => s + Number(li.total), 0)

                  rendered.push(
                    <div key={`pkg-${item.package_id}`} className="border-l-2 border-indigo-200">
                      <div className="px-6 py-2 bg-indigo-50/50 flex items-center justify-between">
                        <p className="text-sm font-medium text-indigo-800">{pkgName}</p>
                        <p className="text-sm font-medium text-ink">${bundleTotal.toFixed(2)}</p>
                      </div>
                      <div className="hidden sm:block">
                        {serviceRows.map((si, j) => (
                          <div
                            key={j}
                            className="px-6 pl-10 py-2 flex items-center justify-between"
                          >
                            <div className="flex-1">
                              <p className="text-xs text-ink3">{si.description}</p>
                              <p className="text-[10px] text-ink4">
                                {si.quantity} &times; ${Number(si.unit_price).toFixed(2)}
                              </p>
                            </div>
                            <p className="text-xs text-ink3">${Number(si.total).toFixed(2)}</p>
                          </div>
                        ))}
                        {discountRow && (
                          <div className="px-6 pl-10 py-2 flex items-center justify-between">
                            <p className="text-xs text-green-600 italic">
                              {discountRow.description}
                            </p>
                            <p className="text-xs text-green-600 italic">
                              -${Math.abs(Number(discountRow.total)).toFixed(2)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                } else if (item.package_id) {
                  // Already rendered as part of group
                } else {
                  // Regular flat item
                  rendered.push(
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm text-ink2">{item.description}</p>
                        <p className="text-xs text-ink4">
                          {item.quantity} &times; ${Number(item.unit_price).toFixed(2)}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-ink">
                        ${Number(item.total).toFixed(2)}
                      </p>
                    </div>
                  )
                }
              }
              return rendered
            })()}
          </div>

          {/* Totals */}
          <div className="border-t border-border-brand px-6 py-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-ink3">Subtotal</span>
              <span>${Number(quote.subtotal).toFixed(2)}</span>
            </div>
            {quote.discount_amount != null && Number(quote.discount_amount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-rose-600">
                  Discount{quote.discount_label ? ` (${quote.discount_label})` : ''}
                </span>
                <span className="text-rose-600">-${Number(quote.discount_amount).toFixed(2)}</span>
              </div>
            )}
            {Number(quote.tax_rate) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ink3">Tax ({quote.tax_rate}%)</span>
                <span>${Number(quote.tax_amount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-2 border-t border-border-brand">
              <span>Total</span>
              <span className="text-teal-600">${Number(quote.total).toFixed(2)}</span>
            </div>
          </div>

          {quote.notes && (
            <div className="border-t border-border-brand px-6 py-4">
              <p className="text-xs text-ink4 mb-1">Notes</p>
              <p className="text-sm text-ink3">{quote.notes}</p>
            </div>
          )}

          {quote.valid_until && !isExpired && (
            <div className="border-t border-border-brand px-6 py-3">
              <p className="text-xs text-ink4">
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

        {/* Deposit info card */}
        {quote.deposit_amount != null && (
          <div className="bg-white rounded-xl border border-border-brand shadow-sm overflow-hidden mt-6">
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">💳</span>
                <h3 className="text-sm font-semibold text-ink">Deposit Information</h3>
              </div>
              <p className="text-sm text-ink3 mb-4">
                A {Number(quote.deposit_pct)}% deposit is required to confirm this quote.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink3">Deposit Due</span>
                  <span className="font-semibold text-ink">
                    ${Number(quote.deposit_amount).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink3">Remaining</span>
                  <span className="text-ink2">${Number(quote.remaining_balance).toFixed(2)}</span>
                </div>
                <p className="text-xs text-ink4">(due at completion)</p>
              </div>
            </div>
            {/* Show Square payment form if available, else fallback contact link */}
            {quote.status === 'accepted' && quote.square_info ? null : quote.contacts?.email ? (
              <div className="border-t border-border-brand px-6 py-3">
                <a
                  href={`mailto:${quote.contacts.email}?subject=${encodeURIComponent(`Deposit payment — ${quote.title}`)}`}
                  className="block w-full text-center py-2 text-sm text-teal-600 font-medium border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
                >
                  Contact us to arrange payment
                </a>
              </div>
            ) : null}
          </div>
        )}

        {/* Square payment section — only when accepted/signed + Square connected */}
        {(quote.status === 'accepted' ||
          acted === 'accepted' ||
          acted === 'signed' ||
          alreadySigned) &&
          quote.square_info && (
            <div className="bg-white rounded-xl border border-border-brand shadow-sm overflow-hidden mt-6">
              <div className="px-6 py-4 border-b border-border-brand">
                <h3 className="text-sm font-semibold text-ink">Pay Now</h3>
                <p className="text-xs text-ink4 mt-1">
                  {quote.deposit_amount != null
                    ? `Deposit due: $${Number(quote.deposit_amount).toFixed(2)}`
                    : `Total: $${Number(quote.total).toFixed(2)}`}
                </p>
              </div>

              {paymentComplete !== null ? (
                <div className="px-6 py-6 text-center">
                  <p className="text-base font-semibold text-green-700 mb-2">Payment complete!</p>
                  {paymentComplete && (
                    <a
                      href={paymentComplete}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal-600 underline"
                    >
                      View receipt
                    </a>
                  )}
                </div>
              ) : (
                <>
                  {/* Tab switcher */}
                  <div className="flex border-b border-border-brand">
                    <button
                      onClick={() => setPayTab('square')}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${payTab === 'square' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-ink4 hover:text-ink3'}`}
                    >
                      Card (Square)
                    </button>
                    <button
                      onClick={() => setPayTab('other')}
                      className={`flex-1 py-2 text-xs font-medium transition-colors ${payTab === 'other' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-ink4 hover:text-ink3'}`}
                    >
                      Other payment
                    </button>
                  </div>

                  {payTab === 'square' ? (
                    <div className="px-6 py-4">
                      {/* Square card form mounts here */}
                      <div id="square-card-container" className="mb-4" />

                      {payError && <p className="text-xs text-rose-600 mb-3">{payError}</p>}

                      <button
                        onClick={() => void payWithSquare()}
                        disabled={paying || !squareCard}
                        className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
                      >
                        {paying
                          ? 'Processing...'
                          : `Pay $${quote.deposit_amount != null ? Number(quote.deposit_amount).toFixed(2) : Number(quote.total).toFixed(2)} with Square`}
                      </button>
                    </div>
                  ) : (
                    <div className="px-6 py-4">
                      {quote.contacts?.email ? (
                        <a
                          href={`mailto:${quote.contacts.email}?subject=${encodeURIComponent(`Payment — ${quote.title}`)}`}
                          className="block w-full text-center py-2 text-sm text-teal-600 font-medium border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
                        >
                          Contact us to arrange payment
                        </a>
                      ) : (
                        <p className="text-sm text-ink3 text-center">
                          Contact {quote.business_name} to arrange payment.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        {/* Signature capture section — shown when requires_signature and waiting */}
        {showSignaturePad && (
          <div className="mt-6 bg-white rounded-xl border border-border-brand shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border-brand">
              <h3 className="text-sm font-semibold text-ink">Sign to accept this proposal</h3>
              <p className="text-xs text-ink4 mt-1">
                By signing below, you agree to the terms outlined in this proposal.
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Canvas pad */}
              <div>
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={180}
                  style={{ maxWidth: '100%', touchAction: 'none' }}
                  className="block border border-gray-300 rounded-lg bg-white cursor-crosshair"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  onTouchStart={handleCanvasTouchStart}
                  onTouchMove={handleCanvasTouchMove}
                  onTouchEnd={handleCanvasTouchEnd}
                />
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="mt-2 text-xs text-ink4 hover:text-ink3 px-2 py-1 border border-gray-200 rounded"
                >
                  Clear
                </button>
              </div>

              {/* Name input */}
              <div>
                <label className="block text-xs text-ink4 mb-1" htmlFor="signer-name">
                  Your full name
                </label>
                <input
                  id="signer-name"
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              {signError && <p className="text-xs text-rose-600">{signError}</p>}

              {/* Sign & Accept button */}
              <button
                type="button"
                onClick={() => void handleSign()}
                disabled={signing || !hasStrokes || !signerName.trim()}
                className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#0d9488' }}
              >
                {signing ? 'Signing...' : 'Sign & Accept'}
              </button>

              {/* Decline still available */}
              <button
                type="button"
                onClick={() => void decline()}
                disabled={acting}
                className="w-full py-2 text-sm text-ink3 hover:text-ink2"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Normal Action buttons — only for non-signature quotes */}
        {canAct && !showSignaturePad && (
          <div className="mt-6 space-y-3">
            <button
              onClick={() => void accept()}
              disabled={acting}
              className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {acting ? 'Processing...' : 'Accept Quote'}
            </button>
            <button
              onClick={() => void decline()}
              disabled={acting}
              className="w-full py-2 text-sm text-ink3 hover:text-ink2"
            >
              Decline
            </button>
          </div>
        )}

        <div className="text-center mt-6">
          <button
            onClick={() => {
              window.open(`/api/quotes/view/${token}/pdf`, '_blank')
            }}
            className="text-xs text-ink4 hover:text-ink3"
          >
            Download PDF
          </button>
        </div>

        <p className="text-center text-[10px] text-gray-300 mt-4">Powered by Nuatis</p>
      </div>
    </div>
  )
}
