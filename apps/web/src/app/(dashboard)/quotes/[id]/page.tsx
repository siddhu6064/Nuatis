import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import QuoteActions from './QuoteActions'

interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  total: number
}

interface Quote {
  id: string
  quote_number: string
  title: string
  status: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  notes: string | null
  valid_until: string | null
  sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
  created_by: string | null
  share_token: string
  created_at: string
  discount_pct: number | null
  discount_amount: number | null
  approval_status: string | null
  approval_note: string | null
  approved_by: string | null
  approved_at: string | null
  deposit_pct: number | null
  deposit_amount: number | null
  remaining_balance: number | null
  contacts: { full_name: string; phone: string | null; email: string | null } | null
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  sent: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Sent' },
  viewed: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Viewed' },
  accepted: { bg: 'bg-green-50', text: 'text-green-700', label: 'Accepted' },
  declined: { bg: 'bg-red-50', text: 'text-red-600', label: 'Declined' },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function QuoteDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const { data: quote } = await supabase
    .from('quotes')
    .select('*, contacts(full_name, phone, email)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single<Quote>()

  if (!quote) notFound()

  const { data: items } = await supabase
    .from('quote_line_items')
    .select('id, description, quantity, unit_price, total')
    .eq('quote_id', id)
    .order('sort_order', { ascending: true })
    .returns<LineItem[]>()

  // Fetch view stats (only relevant for sent/viewed/accepted/declined quotes)
  let viewCount = 0
  let lastViewedAt: string | null = null
  if (quote.status !== 'draft') {
    const { count } = await supabase
      .from('quote_views')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', id)
    viewCount = count ?? 0

    if (viewCount > 0) {
      const { data: latestView } = await supabase
        .from('quote_views')
        .select('viewed_at')
        .eq('quote_id', id)
        .order('viewed_at', { ascending: false })
        .limit(1)
        .single()
      lastViewedAt = latestView?.viewed_at ?? null
    }
  }

  const badge = STATUS_BADGE[quote.status] ?? STATUS_BADGE['draft']!
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  const shareUrl = `${apiUrl}/quotes/view/${quote.share_token}`

  return (
    <div className="px-8 py-8 max-w-3xl">
      <Link
        href="/quotes"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-6"
      >
        &larr; Back to Quotes
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">{quote.quote_number}</h1>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
            >
              {badge.label}
            </span>
            {quote.created_by === 'ai' && (
              <span className="text-xs text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded">
                AI Generated
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{quote.title}</p>
          {quote.status !== 'draft' && (
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path
                  fillRule="evenodd"
                  d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                  clipRule="evenodd"
                />
              </svg>
              {viewCount > 0 ? (
                <span>
                  Viewed {viewCount} time{viewCount !== 1 ? 's' : ''}
                  {lastViewedAt && (
                    <span className="ml-1">
                      · Last viewed{' '}
                      {(() => {
                        const diffMs = Date.now() - new Date(lastViewedAt).getTime()
                        const diffH = Math.floor(diffMs / 3600000)
                        if (diffH < 1) return 'just now'
                        if (diffH < 24) return `${diffH}h ago`
                        return `${Math.floor(diffH / 24)}d ago`
                      })()}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-gray-300">Not yet viewed</span>
              )}
            </p>
          )}
        </div>
        <QuoteActions
          quoteId={quote.id}
          status={quote.status}
          shareUrl={shareUrl}
          approvalStatus={quote.approval_status}
          discountPct={Number(quote.discount_pct ?? 0)}
        />
      </div>

      {/* Approval banners */}
      {quote.approval_status === 'pending' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-amber-800">
            Awaiting Approval — This quote has a {Number(quote.discount_pct)}% discount that
            requires owner approval before sending.
          </p>
        </div>
      )}
      {quote.approval_status === 'approved' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-green-800">
            Approved
            {quote.approved_at &&
              ` on ${new Date(quote.approved_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
          </p>
          {quote.approval_note && (
            <p className="text-xs text-green-600 mt-1">{quote.approval_note}</p>
          )}
        </div>
      )}
      {quote.approval_status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-red-800">
            Rejected — {quote.approval_note || 'No reason given'}. Revise the discount and resubmit.
          </p>
        </div>
      )}

      {/* Contact */}
      {quote.contacts && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <p className="text-sm font-medium text-gray-900">{quote.contacts.full_name}</p>
          <p className="text-xs text-gray-400">
            {[quote.contacts.phone, quote.contacts.email].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      )}

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-gray-100 mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Description</th>
              <th className="text-right text-xs font-medium text-gray-400 px-6 py-3">Qty</th>
              <th className="text-right text-xs font-medium text-gray-400 px-6 py-3">Price</th>
              <th className="text-right text-xs font-medium text-gray-400 px-6 py-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id} className="border-b border-gray-50 last:border-0">
                <td className="px-6 py-3 text-sm text-gray-700">{item.description}</td>
                <td className="px-6 py-3 text-sm text-gray-500 text-right">{item.quantity}</td>
                <td className="px-6 py-3 text-sm text-gray-500 text-right">
                  ${Number(item.unit_price).toFixed(2)}
                </td>
                <td className="px-6 py-3 text-sm text-gray-900 text-right font-medium">
                  ${Number(item.total).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="flex justify-end">
            <div className="w-56 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span>${Number(quote.subtotal).toFixed(2)}</span>
              </div>
              {Number(quote.discount_pct ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-amber-600">Discount ({Number(quote.discount_pct)}%)</span>
                  <span className="text-amber-600">
                    -${Number(quote.discount_amount ?? 0).toFixed(2)}
                  </span>
                </div>
              )}
              {Number(quote.tax_rate) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tax ({quote.tax_rate}%)</span>
                  <span>${Number(quote.tax_amount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold border-t border-gray-100 pt-1">
                <span>Total</span>
                <span className="text-teal-600">${Number(quote.total).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Deposit info */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Deposit</h2>
        {quote.deposit_amount != null ? (
          <div className="space-y-1 text-sm">
            <p className="text-gray-700">
              Deposit: {Number(quote.deposit_pct)}% — ${Number(quote.deposit_amount).toFixed(2)}
            </p>
            <p className="text-gray-700">
              Remaining: ${Number(quote.remaining_balance).toFixed(2)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Not configured</p>
        )}
      </div>

      {/* Notes */}
      {quote.notes && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Notes</h2>
          <p className="text-sm text-gray-600">{quote.notes}</p>
        </div>
      )}

      {/* Activity */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Activity</h2>
        <div className="space-y-2 text-xs text-gray-500">
          <p>
            Created:{' '}
            {new Date(quote.created_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
          {quote.sent_at && (
            <p>
              Sent:{' '}
              {new Date(quote.sent_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {quote.accepted_at && (
            <p className="text-green-600">
              Accepted:{' '}
              {new Date(quote.accepted_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {quote.declined_at && (
            <p className="text-red-600">
              Declined:{' '}
              {new Date(quote.declined_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {quote.valid_until && (
            <p>
              Valid until:{' '}
              {new Date(quote.valid_until).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
