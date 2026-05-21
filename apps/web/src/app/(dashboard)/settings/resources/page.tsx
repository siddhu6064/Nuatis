import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import ResourcesClient from './ResourcesClient'

export default async function ResourcesPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId ?? ''
  const supabase = createAdminClient()

  const { data: resources } = await supabase
    .from('bookable_resources')
    .select('id, name, resource_type, capacity, color, status, notes, location_id')
    .eq('tenant_id', tenantId)
    .neq('status', 'inactive')
    .order('name', { ascending: true })

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Resources</h1>
        <p className="text-sm text-ink3 mt-0.5">Manage bookable rooms, stations, and equipment</p>
      </div>
      <ResourcesClient initialResources={resources ?? []} tenantId={tenantId} />
    </div>
  )
}
