import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import OnboardingWizard from './OnboardingWizard'

export default async function OnboardingPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'
  const businessName = session?.user?.businessName || ''

  const supabase = createAdminClient()

  const [tenantRes, locationRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('onboarding_step, onboarding_completed')
      .eq('id', tenantId)
      .single(),
    supabase
      .from('locations')
      .select('telnyx_number, google_refresh_token')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .maybeSingle(),
  ])

  const currentStep = tenantRes.data?.onboarding_step ?? 1
  const completed = tenantRes.data?.onboarding_completed ?? false

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <OnboardingWizard
        initialStep={currentStep}
        completed={completed}
        businessName={businessName}
        vertical={vertical}
        phoneNumber={locationRes.data?.telnyx_number ?? null}
        calendarConnected={!!locationRes.data?.google_refresh_token}
      />
    </div>
  )
}
