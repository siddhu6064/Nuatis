import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import OrderBuilder from './OrderBuilder'

export default async function NewOrderPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['orders'] === false) redirect('/dashboard')

  const tenantId = session?.user?.tenantId
  const supabase = createAdminClient()

  const [contactsRes, servicesRes, staffRes, dealsRes] = await Promise.all([
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
    supabase
      .from('staff_members')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('deals')
      .select('id, title')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  return (
    <div className="px-8 py-8">
      <OrderBuilder
        contacts={contactsRes.data ?? []}
        services={servicesRes.data ?? []}
        staff={staffRes.data ?? []}
        deals={dealsRes.data ?? []}
      />
    </div>
  )
}
