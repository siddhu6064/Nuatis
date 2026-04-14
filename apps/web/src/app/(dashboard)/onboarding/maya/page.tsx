import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import MayaOnboardingWizard from './MayaOnboardingWizard'

export default async function MayaOnboardingPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'
  const businessName = session?.user?.businessName || ''

  const supabase = createAdminClient()
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number, google_refresh_token')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <MayaOnboardingWizard
        businessName={businessName}
        vertical={vertical}
        phoneNumber={location?.telnyx_number ?? null}
        calendarConnected={!!location?.google_refresh_token}
      />
    </div>
  )
}
