import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import CallFilters from './CallFilters'
import CallLogView from './CallLogView'

interface VoiceSession {
  id: string
  caller_phone: string | null
  caller_name: string | null
  contact_id: string | null
  contacts: { full_name: string } | null
  started_at: string
  duration_seconds: number | null
  first_response_ms: number | null
  outcome: string | null
  language_detected: string | null
  call_quality_mos: number | null
  booked_appointment: boolean
  escalated: boolean
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
      'id, caller_phone, caller_name, contact_id, contacts(full_name), started_at, duration_seconds, first_response_ms, outcome, language_detected, call_quality_mos, booked_appointment, escalated',
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
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Call Log</h1>
        <p className="text-sm text-ink3 mt-0.5">View all inbound calls handled by Maya</p>
      </div>

      <CallFilters outcome={outcome} fromDate={fromDate} toDate={toDate} hasFilters={hasFilters} />

      <CallLogView calls={calls ?? []} total={total} hasFilters={hasFilters} />

      {pages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <Link
            href={`/calls?page=${page - 1}${outcome ? `&outcome=${outcome}` : ''}${fromDate ? `&from_date=${fromDate}` : ''}${toDate ? `&to_date=${toDate}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-lg border border-border-brand ${
              page <= 1 ? 'text-gray-300 pointer-events-none' : 'text-ink3 hover:bg-bg'
            }`}
          >
            Previous
          </Link>
          <span className="text-xs text-ink4">
            Page {page} of {pages}
          </span>
          <Link
            href={`/calls?page=${page + 1}${outcome ? `&outcome=${outcome}` : ''}${fromDate ? `&from_date=${fromDate}` : ''}${toDate ? `&to_date=${toDate}` : ''}`}
            className={`px-3 py-1.5 text-sm rounded-lg border border-border-brand ${
              page >= pages ? 'text-gray-300 pointer-events-none' : 'text-ink3 hover:bg-bg'
            }`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  )
}
