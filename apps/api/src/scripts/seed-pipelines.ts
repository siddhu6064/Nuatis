import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Calls the seed_pipeline_stages(p_tenant_id UUID, p_vertical vertical_type)
// SQL function defined in migration 0001_initial_schema.sql.
//
// Usage:
//   npx tsx src/scripts/seed-pipelines.ts                      # seed both known tenants
//   npx tsx src/scripts/seed-pipelines.ts <tenantId> <vertical>
//
// The SQL function only handles these verticals natively:
//   dental, contractor, salon, law_firm, restaurant, real_estate
// Any other vertical is accepted by the enum but is a no-op in the function
// body — this script flags that and skips so you know to add a branch or
// seed manually.

const SQL_FUNCTION_VERTICALS = new Set([
  'dental',
  'contractor',
  'salon',
  'law_firm',
  'restaurant',
  'real_estate',
])

// Inline fallback stage sets for verticals the SQL function doesn't handle.
// Mirror the shape and colors used by seed_pipeline_stages() so the UI
// renders consistently. Extend here when adding new verticals until the
// SQL function is updated in a migration.
const INLINE_STAGES: Record<
  string,
  Array<{ name: string; position: number; color: string; is_default?: boolean }>
> = {
  sales_crm: [
    { name: 'New lead', position: 1, color: '#888780', is_default: true },
    { name: 'Qualified', position: 2, color: '#378ADD' },
    { name: 'Demo scheduled', position: 3, color: '#EF9F27' },
    { name: 'Proposal sent', position: 4, color: '#7F77DD' },
    { name: 'Negotiation', position: 5, color: '#D85A30' },
    { name: 'Closed won', position: 6, color: '#1D9E75' },
  ],
  medical: [
    { name: 'New patient', position: 1, color: '#888780', is_default: true },
    { name: 'Intake scheduled', position: 2, color: '#378ADD' },
    { name: 'Consultation', position: 3, color: '#EF9F27' },
    { name: 'Active patient', position: 4, color: '#1D9E75' },
    { name: 'Follow-up', position: 5, color: '#7F77DD' },
  ],
  veterinary: [
    { name: 'New inquiry', position: 1, color: '#888780', is_default: true },
    { name: 'Consultation booked', position: 2, color: '#378ADD' },
    { name: 'Under care', position: 3, color: '#EF9F27' },
    { name: 'Recovery', position: 4, color: '#7F77DD' },
    { name: 'Active pet', position: 5, color: '#1D9E75' },
  ],
}

const DEFAULT_TENANTS: Array<{ id: string; vertical: string }> = [
  { id: 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b', vertical: 'dental' },
  { id: '0d9a00b9-ce40-4702-a99c-ed23f11fdb08', vertical: 'sales_crm' },
]

function getSupabase(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env')
  }
  return createClient(url, key)
}

async function seedOne(
  supabase: SupabaseClient,
  tenantId: string,
  vertical: string
): Promise<void> {
  const label = `${tenantId} (${vertical})`

  // Idempotency: if any stages already exist for the tenant, skip — the
  // UNIQUE(tenant_id, position) constraint would otherwise fail on rerun.
  const { count, error: countErr } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if (countErr) {
    console.error(`[seed-pipelines] ✗ ${label} count check failed: ${countErr.message}`)
    return
  }
  if ((count ?? 0) > 0) {
    console.info(`[seed-pipelines] ↷ ${label} — ${count} stages already seeded, skipping`)
    return
  }

  if (SQL_FUNCTION_VERTICALS.has(vertical)) {
    const { error } = await supabase.rpc('seed_pipeline_stages', {
      p_tenant_id: tenantId,
      p_vertical: vertical,
    })
    if (error) {
      console.error(`[seed-pipelines] ✗ ${label} RPC failed: ${error.message}`)
      return
    }
  } else if (INLINE_STAGES[vertical]) {
    const rows = INLINE_STAGES[vertical]!.map((s) => ({
      tenant_id: tenantId,
      name: s.name,
      position: s.position,
      color: s.color,
      is_default: s.is_default ?? false,
    }))
    const { error } = await supabase.from('pipeline_stages').insert(rows)
    if (error) {
      console.error(`[seed-pipelines] ✗ ${label} inline insert failed: ${error.message}`)
      return
    }
  } else {
    console.warn(
      `[seed-pipelines] ⚠ ${label} — no SQL-function branch and no inline fallback. Skipping.`
    )
    return
  }

  const { count: after } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  console.info(`[seed-pipelines] ✓ ${label} seeded (${after ?? 0} stages)`)
}

async function main(): Promise<void> {
  const supabase = getSupabase()

  const argTenant = process.argv[2]
  const argVertical = process.argv[3]

  const targets =
    argTenant && argVertical ? [{ id: argTenant, vertical: argVertical }] : DEFAULT_TENANTS

  console.info(`[seed-pipelines] targets: ${targets.length}`)
  for (const t of targets) {
    await seedOne(supabase, t.id, t.vertical)
  }
  console.info('[seed-pipelines] Done.')
}

main().catch((err) => {
  console.error('[seed-pipelines] fatal:', err)
  process.exit(1)
})
