import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RecurringAppointmentsClient from './RecurringAppointmentsClient'

interface Contact {
  id: string
  full_name: string
}

export default async function RecurringAppointmentsPage() {
  const session = await auth()
  if (!session?.user?.tenantId) redirect('/sign-in')

  const supabase = createAdminClient()
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('tenant_id', session.user.tenantId)
    .order('full_name')
    .returns<Contact[]>()

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-ink4 mb-3">
          <Link href="/appointments" className="hover:text-ink3 transition-colors">
            Appointments
          </Link>
          <span>›</span>
          <span className="text-ink3">Recurring</span>
        </div>
        <h1 className="text-xl font-bold text-ink">Recurring Appointments</h1>
        <p className="text-sm text-ink3 mt-0.5">
          A standing client gets rebooked automatically instead of by hand every time.
        </p>
      </div>

      <RecurringAppointmentsClient contacts={contacts ?? []} />
    </div>
  )
}
