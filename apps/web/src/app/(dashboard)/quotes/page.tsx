import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface Quote {
  id: string
  quote_number: string
  title: string
  status: string
  total: number
  created_by: string | null
  created_at: string
  approval_status: string | null
  contacts: { full_name: string } | null
}

interface QuoteWithViews extends Quote {
  view_count: number
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  sent: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Sent' },
  viewed: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Viewed' },
  accepted: { bg: 'bg-green-50', text: 'text-green-700', label: 'Accepted' },
  declined: { bg: 'bg-red-50', text: 'text-red-600', label: 'Declined' },
  expired: { bg: 'bg-gray-100', text: 'text-gray-400', label: 'Expired' },
}

export default async function QuotesPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data: rawQuotes } = await supabase
    .from('quotes')
    .select(
      'id, quote_number, title, status, total, created_by, created_at, approval_status, contacts(full_name)'
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<Quote[]>()

  // Fetch view counts for all quotes
  const quoteIds = (rawQuotes ?? []).map((q) => q.id)
  const viewCounts: Record<string, number> = {}
  if (quoteIds.length > 0) {
    const { data: views } = await supabase
      .from('quote_views')
      .select('quote_id')
      .in('quote_id', quoteIds)
    if (views) {
      for (const v of views) {
        viewCounts[v.quote_id] = (viewCounts[v.quote_id] ?? 0) + 1
      }
    }
  }

  const quotes: QuoteWithViews[] = (rawQuotes ?? []).map((q) => ({
    ...q,
    view_count: viewCounts[q.id] ?? 0,
  }))

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Quotes</h1>
          <p className="text-sm text-gray-500 mt-0.5">{quotes?.length ?? 0} total</p>
        </div>
        <Link
          href="/quotes/new"
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Quote
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        {!quotes || quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◫</span>
            </div>
            <p className="text-sm font-medium text-gray-400">No quotes yet</p>
            <p className="text-xs text-gray-300 mt-1">
              Create your first quote to send proposals to customers
            </p>
            <Link href="/quotes/new" className="mt-4 text-xs text-teal-600 font-medium">
              New Quote &rarr;
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Quote #</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Title</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Total</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Status</th>
                <th className="text-center text-xs font-medium text-gray-400 px-6 py-3">Views</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const badge = STATUS_BADGE[q.status] ?? STATUS_BADGE['draft']!
                return (
                  <tr
                    key={q.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/quotes/${q.id}`}
                        className="text-sm font-mono text-teal-600 hover:text-teal-700"
                      >
                        {q.quote_number}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {q.contacts?.full_name ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{q.title}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      ${Number(q.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                      {q.created_by === 'ai' && (
                        <span className="ml-1 text-[10px] text-teal-500">AI</span>
                      )}
                      {q.approval_status === 'pending' && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                          Needs Approval
                        </span>
                      )}
                      {q.approval_status === 'rejected' && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600">
                          Rejected
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {q.status !== 'draft' ? (
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${q.view_count > 0 ? 'text-gray-600' : 'text-gray-300'}`}
                        >
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
                          {q.view_count}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-200">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {new Date(q.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
