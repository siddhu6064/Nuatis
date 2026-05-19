import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import BusinessProfileForm from './BusinessProfileForm'
import type { BusinessProfile } from '@nuatis/shared'

export default async function BusinessProfilePage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  let profile: BusinessProfile = {}

  if (tenantId) {
    // Try is_primary first, fallback to first location by created_at
    const { data: primary } = await supabase
      .from('locations')
      .select('business_profile')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .maybeSingle<{ business_profile: BusinessProfile | null }>()

    if (primary) {
      profile = primary.business_profile ?? {}
    } else {
      const { data: fallback } = await supabase
        .from('locations')
        .select('business_profile')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<{ business_profile: BusinessProfile | null }>()
      profile = fallback?.business_profile ?? {}
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Business Profile</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Maya uses this information to answer caller questions about your business
        </p>
      </div>
      <BusinessProfileForm initialProfile={profile} />
    </div>
  )
}
