import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import QuoteBuilder from './QuoteBuilder'

export default async function NewQuotePage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const [contactsRes, servicesRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, full_name, phone, email')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('full_name', { ascending: true })
      .limit(200),
    supabase
      .from('services')
      .select('id, name, unit_price, unit, category')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  return (
    <div className="px-8 py-8">
      <QuoteBuilder contacts={contactsRes.data ?? []} services={servicesRes.data ?? []} />
    </div>
  )
}
