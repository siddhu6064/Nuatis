import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import PhoneNumbersClient, { type TelnyxNumberRow } from './PhoneNumbersClient'

export default async function PhoneNumbersPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const supabase = createAdminClient()

  const { data: numbers } = await supabase
    .from('telnyx_numbers')
    .select('id, phone_number, label, department, is_primary, maya_enabled, forwarding_number, status, created_at')
    .eq('tenant_id', tenantId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Phone Numbers</h1>
        <p className="text-sm text-ink3 mt-0.5">Manage Telnyx numbers and department routing for Maya</p>
      </div>
      <PhoneNumbersClient initialNumbers={(numbers ?? []) as unknown as TelnyxNumberRow[]} />
    </div>
  )
}
