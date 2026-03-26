import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AddAppointmentForm from './AddAppointmentForm'

interface Contact {
  id: string
  full_name: string
}

export default async function NewAppointmentPage() {
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
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <Link href="/appointments" className="hover:text-gray-600 transition-colors">
            Appointments
          </Link>
          <span>›</span>
          <span className="text-gray-600">New Appointment</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900">New Appointment</h1>
        <p className="text-sm text-gray-500 mt-0.5">Schedule a new appointment</p>
      </div>

      <AddAppointmentForm contacts={contacts ?? []} />
    </div>
  )
}
