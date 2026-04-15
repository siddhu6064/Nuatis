import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import InsightsDashboard from './InsightsDashboard'
import ReferralInsights from '@/components/insights/ReferralInsights'

export default async function InsightsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'

  const supabase = createAdminClient()
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()

  // Parallel initial data fetch
  const [
    sessionsRes,
    appointmentsRes,
    contactsRes,
    entriesRes,
    quotesRes,
    quoteViewsRes,
    pkgLineItemsRes,
    pkgRecordsRes,
  ] = await Promise.all([
    supabase
      .from('voice_sessions')
      .select(
        'id, started_at, duration_seconds, first_response_ms, call_quality_mos, outcome, language_detected, tool_calls_made, booked_appointment'
      )
      .eq('tenant_id', tenantId)
      .gte('started_at', thirtyDaysAgo)
      .order('started_at', { ascending: true }),

    supabase
      .from('appointments')
      .select('id, created_at, created_by_call, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', thirtyDaysAgo),

    supabase
      .from('contacts')
      .select('id, source, follow_up_step, created_at')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false),

    supabase
      .from('pipeline_entries')
      .select('status, pipeline_stages(name)')
      .eq('tenant_id', tenantId),

    supabase
      .from('quotes')
      .select('id, status, total, created_by, created_at, sent_at, accepted_at, declined_at')
      .eq('tenant_id', tenantId),

    supabase.from('quote_views').select('quote_id, viewed_at').eq('tenant_id', tenantId),

    supabase
      .from('quote_line_items')
      .select('quote_id, package_id, total')
      .not('package_id', 'is', null),

    supabase.from('service_packages').select('id, name, vertical').eq('tenant_id', tenantId),
  ])

  return (
    <div className="px-8 py-8">
      <InsightsDashboard
        sessions={sessionsRes.data ?? []}
        appointments={appointmentsRes.data ?? []}
        contacts={contactsRes.data ?? []}
        pipelineEntries={entriesRes.data ?? []}
        quotes={quotesRes.data ?? []}
        quoteViews={quoteViewsRes.data ?? []}
        packageLineItems={pkgLineItemsRes.data ?? []}
        packageRecords={pkgRecordsRes.data ?? []}
        vertical={vertical}
      />
      <ReferralInsights />
    </div>
  )
}
