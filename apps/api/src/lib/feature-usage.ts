import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultEntitlement } from '../config/stripe-plans.js'

/**
 * Feature-adoption stats derived entirely from tables features already write
 * to on real use — no new event-capture instrumentation, no new table. Each
 * bucket's backing table/column was chosen because a row there IS the
 * feature being used (a quote created, a shift clocked in), not a page view.
 */
interface FeatureBucket {
  moduleId: string
  label: string
  table: string
  dateColumn: string
}

const FEATURE_BUCKETS: FeatureBucket[] = [
  { moduleId: 'scheduling', label: 'Scheduling', table: 'appointments', dateColumn: 'created_at' },
  { moduleId: 'pipeline', label: 'Pipeline', table: 'deals', dateColumn: 'created_at' },
  {
    moduleId: 'automation',
    label: 'Automation',
    table: 'custom_automations',
    dateColumn: 'created_at',
  },
  {
    moduleId: 'campaigns',
    label: 'AI Campaigns',
    table: 'campaign_sends',
    dateColumn: 'created_at',
  },
  { moduleId: 'cpq', label: 'CPQ', table: 'quotes', dateColumn: 'created_at' },
  { moduleId: 'orders', label: 'Orders', table: 'orders', dateColumn: 'created_at' },
  { moduleId: 'expenses', label: 'Expenses', table: 'expenses', dateColumn: 'created_at' },
  {
    moduleId: 'staff-portal',
    label: 'Staff Portal',
    table: 'time_entries',
    dateColumn: 'clock_in_at',
  },
]

export interface FeatureUsageRow {
  moduleId: string
  label: string
  tenantsEnabled: number
  tenantsActive: number
  adoptionPct: number
}

interface TenantRow {
  id: string
  modules: Record<string, boolean> | null
  subscription_plan: string | null
  product: string | null
}

/**
 * For each feature bucket: how many tenants have the module enabled, and of
 * those, how many actually created a row in its backing table within the
 * trailing `windowDays`. Entitlement math mirrors lib/modules.ts's
 * resolveEntitlement() but computed in-process against one bulk tenant
 * fetch instead of one query per tenant per module.
 */
export async function getFeatureUsageSummary(
  supabase: SupabaseClient,
  windowDays = 30
): Promise<FeatureUsageRow[]> {
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, modules, subscription_plan, product')

  const rows = (tenants ?? []) as TenantRow[]
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const results: FeatureUsageRow[] = []
  for (const bucket of FEATURE_BUCKETS) {
    const enabledTenantIds = rows
      .filter((t) => {
        const explicit = t.modules ? t.modules[bucket.moduleId] : undefined
        return typeof explicit === 'boolean'
          ? explicit
          : defaultEntitlement(bucket.moduleId, t.subscription_plan, t.product)
      })
      .map((t) => t.id)

    let tenantsActive = 0
    if (enabledTenantIds.length > 0) {
      const { data: activeRows } = await supabase
        .from(bucket.table)
        .select('tenant_id')
        .in('tenant_id', enabledTenantIds)
        .gte(bucket.dateColumn, since)

      tenantsActive = new Set((activeRows ?? []).map((r) => r['tenant_id'] as string)).size
    }

    results.push({
      moduleId: bucket.moduleId,
      label: bucket.label,
      tenantsEnabled: enabledTenantIds.length,
      tenantsActive,
      adoptionPct:
        enabledTenantIds.length > 0
          ? Math.round((tenantsActive / enabledTenantIds.length) * 100)
          : 0,
    })
  }

  return results
}
