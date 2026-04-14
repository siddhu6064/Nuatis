import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import CallFilters from './CallFilters'

interface VoiceSession {
  id: string
  caller_phone: string | null
  caller_name: string | null
  started_at: string
  duration_seconds: number | null
  first_response_ms: number | null
  outcome: string | null
  language_detected: string | null
  call_quality_mos: number | null
  booked_appointment: boolean
  escalated: boolean
}

const OUTCOME_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  booking_made: { label: 'Booking Made', bg: 'bg-green-50', text: 'text-green-700' },
  inquiry_answered: { label: 'Inquiry', bg: 'bg-blue-50', text: 'text-blue-700' },
  escalated: { label: 'Escalated', bg: 'bg-amber-50', text: 'text-amber-700' },
  abandoned: { label: 'Abandoned', bg: 'bg-red-50', text: 'text-red-600' },
  general: { label: 'General', bg: 'bg-gray-100', text: 'text-gray-600' },
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Unknown'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '--'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

const LIMIT = 20

interface Props {
  searchParams: Promise<{
    page?: string
    outcome?: string
    from_date?: string
    to_date?: string
  }>
}

export default async function CallsPage({ searchParams }: Props) {
  const params = await searchParams
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const outcome = params.outcome || null
  const fromDate = params.from_date || null
  const toDate = params.to_date || null

  const offset = (page - 1) * LIMIT

  const supabase = createAdminClient()

  let query = supabase
    .from('voice_sessions')
    .select(
      'id, caller_phone, caller_name, started_at, duration_seconds, first_response_ms, outcome, language_detected, call_quality_mos, booked_appointment, escalated',
      { count: 'exact' }
    )
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
    .range(offset, offset + LIMIT - 1)

  if (outcome) query = query.eq('outcome', outcome)
  if (fromDate) query = query.gte('started_at', fromDate)
  if (toDate) query = query.lte('started_at', toDate)

  const { data: calls, count } = await query.returns<VoiceSession[]>()

  const total = count ?? 0
  const pages = Math.ceil(total / LIMIT)
  const hasFilters = !!(outcome || fromDate || toDate)

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Call Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">View all inbound calls handled by Maya</p>
      </div>

      {/* Filters */}
      <CallFilters outcome={outcome} fromDate={fromDate} toDate={toDate} hasFilters={hasFilters} />

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400">
          Showing {calls?.length ?? 0} of {total} calls
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100">
        {!calls || calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◉</span>
            </div>
            <p className="text-sm font-medium text-gray-400">
              {hasFilters ? 'No calls match your filters' : 'No calls yet'}
            </p>
            <p className="text-xs text-gray-300 mt-1">
              {hasFilters
                ? 'Try adjusting your filters'
                : "Once Maya starts handling calls, they'll appear here"}
            </p>
            {hasFilters && (
              <Link href="/calls" className="mt-4 text-xs text-teal-600 font-medium">
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Caller</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">
                  Date &amp; Time
                </th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Duration</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Outcome</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Lang</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Latency</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">MOS</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const badge = OUTCOME_BADGES[call.outcome ?? 'general'] ?? OUTCOME_BADGES.general
                return (
                  <tr
                    key={call.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-4">
                      <Link href={`/calls/${call.id}`} className="block">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                            <span className="text-teal-700 text-xs font-bold">
                              {(call.caller_name ?? call.caller_phone ?? '?')
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {call.caller_name || formatPhone(call.caller_phone)}
                            </p>
                            {call.caller_name && (
                              <p className="text-xs text-gray-400 truncate">
                                {formatPhone(call.caller_phone)}
                              </p>
                            )}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/calls/${call.id}`} className="block text-sm text-gray-500">
                        {new Date(call.started_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        <span className="mx-1 text-gray-300">&middot;</span>
                        {new Date(call.started_at).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <Link href={`/calls/${call.id}`} className="block">
                        {formatDuration(call.duration_seconds)}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/calls/${call.id}`} className="block">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge!.bg} ${badge!.text}`}
                        >
                          {badge!.label}
                        </span>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-400 uppercase">
                      {call.language_detected ?? '--'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatLatency(call.first_response_ms)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {call.call_quality_mos != null
                        ? Number(call.call_quality_mos).toFixed(2)
                        : '--'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Link
            href={`/calls?page=${page - 1}${outcome ? `&outcome=${outcome}` : ''}${fromDate ? `&from_date=${fromDate}` : ''}${toDate ? `&to_date=${toDate}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-lg border border-gray-200 ${
              page <= 1 ? 'text-gray-300 pointer-events-none' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Previous
          </Link>
          <span className="text-xs text-gray-400">
            Page {page} of {pages}
          </span>
          <Link
            href={`/calls?page=${page + 1}${outcome ? `&outcome=${outcome}` : ''}${fromDate ? `&from_date=${fromDate}` : ''}${toDate ? `&to_date=${toDate}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-lg border border-gray-200 ${
              page >= pages ? 'text-gray-300 pointer-events-none' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  )
}
