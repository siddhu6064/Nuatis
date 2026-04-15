/**
 * Seed default saved views for a tenant.
 * Usage: npx tsx apps/api/src/scripts/seed-saved-views.ts <tenant_id> <vertical>
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
const vertical = process.argv[3]

if (!tenantId || !vertical) {
  console.error('Usage: npx tsx apps/api/src/scripts/seed-saved-views.ts <tenant_id> <vertical>')
  process.exit(1)
}

interface ViewSeed {
  name: string
  filters: Record<string, unknown>
  sort_by?: string
  sort_dir?: string
  is_default?: boolean
  sort_order: number
}

async function findStageId(stageName: string): Promise<string | null> {
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .ilike('name', `%${stageName}%`)
    .limit(1)
    .maybeSingle()

  return data?.id ?? null
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0]!
}

async function getVerticalViews(): Promise<ViewSeed[]> {
  const views: ViewSeed[] = []
  let order = 3

  switch (vertical) {
    case 'dental': {
      const activeStage = await findStageId('Active patient')
      views.push({
        name: 'Due for Recall',
        filters: {
          last_contacted_to: daysAgo(180),
          ...(activeStage ? { pipeline_stage_id: activeStage } : {}),
        },
        sort_order: order++,
      })
      views.push({
        name: 'New Patients',
        filters: { source: 'inbound_call,web_form', created_from: daysAgo(30) },
        sort_order: order++,
      })
      break
    }
    case 'contractor': {
      views.push({
        name: 'Estimates Pending',
        filters: { has_open_quote: 'true' },
        sort_order: order++,
      })
      const jobStage = await findStageId('Job scheduled')
      if (jobStage) {
        views.push({
          name: 'Active Jobs',
          filters: { pipeline_stage_id: jobStage },
          sort_order: order++,
        })
      }
      break
    }
    case 'law_firm': {
      const activeMatter = await findStageId('Active matter')
      if (activeMatter) {
        views.push({
          name: 'Active Matters',
          filters: { pipeline_stage_id: activeMatter },
          sort_order: order++,
        })
      }
      views.push({
        name: 'New Inquiries',
        filters: { source: 'inbound_call,web_form', created_from: daysAgo(14) },
        sort_order: order++,
      })
      break
    }
    case 'real_estate': {
      const showingStage = await findStageId('Showing booked')
      if (showingStage) {
        views.push({
          name: 'Active Buyers',
          filters: { pipeline_stage_id: showingStage },
          sort_order: order++,
        })
      }
      views.push({
        name: 'Recent Leads',
        filters: { created_from: daysAgo(30) },
        sort_order: order++,
      })
      break
    }
    case 'salon': {
      views.push({
        name: 'Lapsed Clients',
        filters: { last_contacted_to: daysAgo(90) },
        sort_order: order++,
      })
      views.push({
        name: 'New Clients',
        filters: { created_from: daysAgo(30) },
        sort_order: order++,
      })
      break
    }
    case 'restaurant': {
      views.push({
        name: 'Repeat Guests',
        filters: { tags: 'vip' },
        sort_order: order++,
      })
      break
    }
    case 'sales_crm': {
      const qualifiedStage = await findStageId('Demo done')
      if (qualifiedStage) {
        views.push({
          name: 'Hot Leads',
          filters: { pipeline_stage_id: qualifiedStage },
          sort_order: order++,
        })
      }
      views.push({
        name: 'Stalled',
        filters: { has_open_quote: 'true', last_contacted_to: daysAgo(14) },
        sort_order: order++,
      })
      break
    }
  }

  return views
}

async function main() {
  console.info(`Seeding saved views for tenant=${tenantId} vertical=${vertical}`)

  // Common views for all verticals
  const commonViews: ViewSeed[] = [
    { name: 'All Contacts', filters: {}, is_default: true, sort_order: 0 },
    {
      name: 'Recent',
      filters: { created_from: daysAgo(30) },
      sort_by: 'created_at',
      sort_dir: 'desc',
      sort_order: 1,
    },
    { name: 'Needs Follow-up', filters: { last_contacted_to: daysAgo(7) }, sort_order: 2 },
  ]

  const verticalViews = await getVerticalViews()
  const allViews = [...commonViews, ...verticalViews]

  // Delete existing shared views to avoid duplicates
  await supabase
    .from('saved_views')
    .delete()
    .eq('tenant_id', tenantId)
    .is('user_id', null)
    .eq('object_type', 'contacts')

  for (const view of allViews) {
    const { error } = await supabase.from('saved_views').insert({
      tenant_id: tenantId,
      user_id: null,
      name: view.name,
      object_type: 'contacts',
      filters: view.filters,
      sort_by: view.sort_by ?? null,
      sort_dir: view.sort_dir ?? 'desc',
      is_default: view.is_default ?? false,
      sort_order: view.sort_order,
    })

    if (error) {
      console.error(`  Failed to insert "${view.name}":`, error.message)
    } else {
      console.info(`  Seeded: "${view.name}"`)
    }
  }

  console.info(`Done — ${allViews.length} views seeded`)
}

void main()
