import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { VERTICALS } from '@nuatis/shared'
import VoiceSettingsForm from './VoiceSettingsForm'

interface LocationSettings {
  maya_enabled: boolean
  escalation_phone: string | null
  maya_greeting: string | null
  maya_personality: string
  preferred_languages: string[]
  appointment_duration_default: number
  telnyx_number: string | null
}

export default async function VoiceSettingsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'

  const supabase = createAdminClient()
  const { data: location } = await supabase
    .from('locations')
    .select(
      'maya_enabled, escalation_phone, maya_greeting, maya_personality, preferred_languages, appointment_duration_default, telnyx_number'
    )
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle<LocationSettings>()

  const verticalConfig = VERTICALS[vertical]
  const businessHours = verticalConfig?.business_hours ?? {
    mon_fri: '9am-5pm',
    sat: 'closed',
    sun: 'closed',
  }

  const settings = {
    maya_enabled: location?.maya_enabled ?? true,
    escalation_phone: location?.escalation_phone ?? '',
    maya_greeting: location?.maya_greeting ?? '',
    maya_personality: location?.maya_personality ?? 'professional',
    preferred_languages: location?.preferred_languages ?? ['en'],
    appointment_duration_default: location?.appointment_duration_default ?? 60,
    telnyx_number: location?.telnyx_number ?? null,
    business_hours: businessHours,
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Voice AI Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure how Maya handles your calls</p>
      </div>

      <VoiceSettingsForm settings={settings} />
    </div>
  )
}
