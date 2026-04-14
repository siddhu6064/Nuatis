import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import LocationsManager from './LocationsManager'

interface Location {
  id: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  telnyx_number: string | null
  maya_enabled: boolean
  is_primary: boolean
  google_refresh_token: string | null
  created_at: string
}

export default async function LocationsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('locations')
    .select(
      'id, name, address, city, state, telnyx_number, maya_enabled, is_primary, google_refresh_token, created_at'
    )
    .eq('tenant_id', tenantId)
    .order('is_primary', { ascending: false })
    .returns<Location[]>()

  const locations = (data ?? []).map((l) => ({
    ...l,
    calendar_connected: !!l.google_refresh_token,
  }))

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Locations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your business locations</p>
      </div>
      <LocationsManager initialLocations={locations} />
    </div>
  )
}
