import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import 'dotenv/config'

// Inline stage definitions. Positions are 1-based within a vertical; the
// script offsets them by the tenant's current max position to satisfy the
// UNIQUE(tenant_id, position) constraint on pipeline_stages.
const INLINE_STAGES: Record<
  string,
  Array<{
    name: string
    position: number
    color: string
    is_default?: boolean
    is_terminal?: boolean
  }>
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
  spa: [
    { name: 'Inquiry', position: 1, color: '#888780', is_default: true },
    { name: 'Consultation Booked', position: 2, color: '#378ADD' },
    { name: 'First Visit', position: 3, color: '#EF9F27' },
    { name: 'Returning Client', position: 4, color: '#2DA89C' },
    { name: 'Member', position: 5, color: '#1D9E75' },
  ],
  gym: [
    { name: 'Lead', position: 1, color: '#3B82F6', is_default: true },
    { name: 'Trial Session', position: 2, color: '#F59E0B' },
    { name: 'Active Member', position: 3, color: '#22C55E' },
    { name: 'At-Risk Member', position: 4, color: '#EF4444' },
    { name: 'Lapsed', position: 5, color: '#6B7280', is_terminal: true },
  ],
}

function getSupabase(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env')
  }
  return createClient(url, key)
}

function toTitle(vertical: string): string {
  return vertical
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function main(): Promise<void> {
  const tenantId = process.argv[2]
  const vertical = process.argv[3]

  if (!tenantId || !vertical) {
    console.error('Usage: npx tsx seed-pipelines.ts <tenantId> <vertical>')
    process.exit(1)
  }

  const supabase = getSupabase()
  const label = `${tenantId} (${vertical})`

  // Skip if a pipeline for this vertical already exists on the tenant.
  const { data: existing, error: existErr } = await supabase
    .from('pipelines')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${vertical}%`)
    .maybeSingle()

  if (existErr) {
    console.error(`[seed-pipelines] ✗ ${label} existence check failed: ${existErr.message}`)
    process.exit(1)
  }
  if (existing) {
    console.info(`[seed-pipelines] ↷ ${label} — pipeline already exists, skipping`)
    return
  }

  const stages = INLINE_STAGES[vertical]
  if (!stages) {
    console.warn(`[seed-pipelines] ⚠ ${label} — no inline stages defined. Skipping.`)
    return
  }

  // Create the pipeline row.
  const pipelineName = `${toTitle(vertical)} Pipeline`
  const { data: pipeline, error: pipelineErr } = await supabase
    .from('pipelines')
    .insert({ tenant_id: tenantId, name: pipelineName, is_default: false })
    .select('id')
    .single()

  if (pipelineErr || !pipeline) {
    console.error(
      `[seed-pipelines] ✗ ${label} pipeline insert failed: ${pipelineErr?.message ?? 'no data'}`
    )
    process.exit(1)
  }

  // Find the current max position for this tenant so new stages don't collide
  // with the UNIQUE(tenant_id, position) constraint.
  const { data: maxRow } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const offset = (maxRow as { position?: number } | null)?.position ?? 0

  const rows = stages.map((s) => ({
    tenant_id: tenantId,
    pipeline_id: (pipeline as { id: string }).id,
    name: s.name,
    position: s.position + offset,
    color: s.color,
    is_default: s.is_default ?? false,
  }))

  const { error: stagesErr } = await supabase.from('pipeline_stages').insert(rows)
  if (stagesErr) {
    console.error(`[seed-pipelines] ✗ ${label} stages insert failed: ${stagesErr.message}`)
    process.exit(1)
  }

  console.info(`[seed-pipelines] ✓ ${label} seeded (${rows.length} stages)`)
}

main().catch((err) => {
  console.error('[seed-pipelines] fatal:', err)
  process.exit(1)
})
