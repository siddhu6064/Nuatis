import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { VERTICALS } from '@nuatis/shared'
import VoiceSettingsForm from './VoiceSettingsForm'
import TestMayaPanel from './TestMayaPanel'
import KnowledgeFilesCard from './KnowledgeFilesCard'
import WebsiteKnowledgeCard from './WebsiteKnowledgeCard'

interface DaySchedule {
  open: string
  close: string
  enabled: boolean
}

interface LocationSettings {
  maya_enabled: boolean
  escalation_phone: string | null
  maya_greeting: string | null
  maya_personality: string
  preferred_languages: string[]
  appointment_duration_default: number
  telnyx_number: string | null
  after_hours_enabled: boolean | null
  business_hours: Record<string, DaySchedule> | null
  after_hours_message: string | null
  timezone: string | null
}

export default async function VoiceSettingsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'

  const supabase = createAdminClient()
  const { data: location } = await supabase
    .from('locations')
    .select(
      'maya_enabled, escalation_phone, maya_greeting, maya_personality, preferred_languages, appointment_duration_default, telnyx_number, after_hours_enabled, business_hours, after_hours_message, timezone'
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

  const defaultSchedule: Record<string, DaySchedule> = {
    mon: { open: '09:00', close: '17:00', enabled: true },
    tue: { open: '09:00', close: '17:00', enabled: true },
    wed: { open: '09:00', close: '17:00', enabled: true },
    thu: { open: '09:00', close: '17:00', enabled: true },
    fri: { open: '09:00', close: '17:00', enabled: true },
    sat: { open: '09:00', close: '13:00', enabled: false },
    sun: { open: '09:00', close: '13:00', enabled: false },
  }

  const { data: kbFiles } = await supabase
    .from('maya_kb_files')
    .select('id, file_name, file_size, status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const { data: kbUrls } = await supabase
    .from('maya_kb_urls')
    .select('id, tenant_id, url, status, pages_crawled, extracted_text, error_message, last_crawled_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const settings = {
    maya_enabled: location?.maya_enabled ?? true,
    escalation_phone: location?.escalation_phone ?? '',
    maya_greeting: location?.maya_greeting ?? '',
    maya_personality: location?.maya_personality ?? 'professional',
    preferred_languages: location?.preferred_languages ?? ['en'],
    appointment_duration_default: location?.appointment_duration_default ?? 60,
    telnyx_number: location?.telnyx_number ?? null,
    business_hours: businessHours,
    after_hours_enabled: location?.after_hours_enabled ?? false,
    after_hours_schedule: location?.business_hours ?? defaultSchedule,
    after_hours_message:
      location?.after_hours_message ??
      'We are currently closed. Please leave your name and number and we will call you back during business hours.',
    timezone: location?.timezone ?? 'America/Chicago',
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Voice AI Settings</h1>
        <p className="text-sm text-ink3 mt-0.5">Configure how Maya handles your calls</p>
      </div>

      <TestMayaPanel />
      <VoiceSettingsForm settings={settings} />
      <KnowledgeFilesCard initialFiles={kbFiles ?? []} />
      <WebsiteKnowledgeCard initialUrls={kbUrls ?? []} />
    </div>
  )
}
