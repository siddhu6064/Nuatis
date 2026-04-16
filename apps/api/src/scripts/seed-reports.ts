/**
 * Seed starter reports for a tenant.
 * Usage: npx tsx apps/api/src/scripts/seed-reports.ts <tenant_id> [vertical]
 */
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const url = process.env['SUPABASE_URL']
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(url, key)

const tenantId = process.argv[2]
const vertical = process.argv[3] ?? 'sales_crm'

if (!tenantId) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-reports.ts <tenant_id> [vertical]')
  process.exit(1)
}

interface ReportSeed {
  name: string
  description?: string
  object: string
  metric: string
  metric_field?: string
  group_by: string
  date_range?: string
  chart_type: string
  pin_order: number
}

const REPORTS_BY_VERTICAL: Record<string, ReportSeed[]> = {
  dental: [
    {
      name: 'Patients by Lifecycle Stage',
      object: 'contacts',
      metric: 'count',
      group_by: 'lifecycle_stage',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'Appointments This Month',
      object: 'appointments',
      metric: 'count',
      group_by: 'status',
      date_range: 'this_month',
      chart_type: 'bar',
      pin_order: 1,
    },
    {
      name: 'Quote Revenue by Status',
      object: 'quotes',
      metric: 'sum',
      metric_field: 'total',
      group_by: 'status',
      chart_type: 'bar',
      date_range: 'last_90_days',
      pin_order: 2,
    },
  ],

  contractor: [
    {
      name: 'Deal Value by Stage',
      object: 'deals',
      metric: 'sum',
      metric_field: 'value',
      group_by: 'stage_name',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'Leads by Source',
      object: 'contacts',
      metric: 'count',
      group_by: 'source',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 1,
    },
    {
      name: 'Quote Conversion',
      object: 'quotes',
      metric: 'count',
      group_by: 'status',
      chart_type: 'pie',
      date_range: 'last_90_days',
      pin_order: 2,
    },
  ],

  law_firm: [
    {
      name: 'Matters Value by Stage',
      object: 'deals',
      metric: 'sum',
      metric_field: 'value',
      group_by: 'stage_name',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'Client Intake Trend',
      object: 'contacts',
      metric: 'count',
      group_by: 'created_month',
      date_range: 'last_90_days',
      chart_type: 'line',
      pin_order: 1,
    },
    {
      name: 'Activity by Type',
      object: 'activity_log',
      metric: 'count',
      group_by: 'type',
      date_range: 'last_30_days',
      chart_type: 'bar',
      pin_order: 2,
    },
  ],

  real_estate: [
    {
      name: 'Deals by Agent',
      object: 'deals',
      metric: 'count',
      group_by: 'assigned_to_user_id',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'Pipeline Value by Stage',
      object: 'deals',
      metric: 'sum',
      metric_field: 'value',
      group_by: 'stage_name',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 1,
    },
    {
      name: 'Contacts by Territory',
      object: 'contacts',
      metric: 'count',
      group_by: 'territory',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 2,
    },
  ],

  salon: [
    {
      name: 'Bookings by Status',
      object: 'appointments',
      metric: 'count',
      group_by: 'status',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'New Clients by Source',
      object: 'contacts',
      metric: 'count',
      group_by: 'source',
      date_range: 'this_month',
      chart_type: 'bar',
      pin_order: 1,
    },
    {
      name: 'Quote Revenue Trend',
      object: 'quotes',
      metric: 'sum',
      metric_field: 'total',
      group_by: 'created_month',
      date_range: 'last_12_months',
      chart_type: 'line',
      pin_order: 2,
    },
  ],

  restaurant: [
    {
      name: 'Reservations Trend',
      object: 'appointments',
      metric: 'count',
      group_by: 'created_month',
      date_range: 'last_30_days',
      chart_type: 'line',
      pin_order: 0,
    },
    {
      name: 'Contacts by Source',
      object: 'contacts',
      metric: 'count',
      group_by: 'source',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 1,
    },
    {
      name: 'Activity Overview',
      object: 'activity_log',
      metric: 'count',
      group_by: 'type',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 2,
    },
  ],

  sales_crm: [
    {
      name: 'Pipeline by Stage',
      object: 'deals',
      metric: 'count',
      group_by: 'stage_name',
      chart_type: 'bar',
      date_range: 'all_time',
      pin_order: 0,
    },
    {
      name: 'Deal Revenue Trend',
      object: 'deals',
      metric: 'sum',
      metric_field: 'value',
      group_by: 'close_month',
      date_range: 'last_12_months',
      chart_type: 'line',
      pin_order: 1,
    },
    {
      name: 'Lead Score Distribution',
      object: 'contacts',
      metric: 'count',
      group_by: 'lead_grade',
      chart_type: 'pie',
      date_range: 'all_time',
      pin_order: 2,
    },
  ],
}

async function main() {
  console.info(`Seeding reports for tenant=${tenantId} vertical=${vertical}`)

  const reports = REPORTS_BY_VERTICAL[vertical] ?? REPORTS_BY_VERTICAL['sales_crm']!

  // Fetch existing report names for this tenant to support idempotent inserts
  const { data: existing, error: fetchError } = await supabase
    .from('reports')
    .select('name')
    .eq('tenant_id', tenantId)

  if (fetchError) {
    console.error(`[seed-reports] error fetching existing reports: ${fetchError.message}`)
    process.exit(1)
  }

  const existingNames = new Set((existing ?? []).map((r: { name: string }) => r.name))

  const toInsert = reports
    .filter((r) => !existingNames.has(r.name))
    .map((r) => ({
      tenant_id: tenantId,
      name: r.name,
      description: r.description ?? null,
      object: r.object,
      metric: r.metric,
      metric_field: r.metric_field ?? null,
      group_by: r.group_by,
      filters: [],
      date_range: r.date_range ?? 'last_30_days',
      chart_type: r.chart_type,
      pinned_to_dashboard: true,
      pin_order: r.pin_order,
    }))

  if (toInsert.length === 0) {
    console.info(`[seed-reports] all reports already exist for tenant=${tenantId} — skipping`)
    return
  }

  const { error: insertError } = await supabase.from('reports').insert(toInsert)

  if (insertError) {
    console.error(`[seed-reports] insert error: ${insertError.message}`)
    process.exit(1)
  }

  console.info(`[seed-reports] inserted ${toInsert.length} report(s) for tenant=${tenantId}`)

  const skipped = reports.length - toInsert.length
  if (skipped > 0) {
    console.info(`[seed-reports] skipped ${skipped} already-existing report(s)`)
  }
}

main().catch(console.error)
