import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import AppointmentsCalendar from './AppointmentsCalendar'

interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'canceled' | 'rescheduled'
  notes: string | null
  contacts: { full_name: string } | null
  staff_members: { id: string; name: string; color_hex: string } | null
}

interface StaffMember {
  id: string
  name: string
  color_hex: string
}

export default async function AppointmentsPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['appointments'] === false) redirect('/dashboard')
  const tenantId = session?.user?.tenantId as string
  const userRole = (session?.user as { role?: string })?.role ?? 'member'

  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - 7)
  windowStart.setHours(0, 0, 0, 0)

  const windowEnd = new Date()
  windowEnd.setDate(windowEnd.getDate() + 28)
  windowEnd.setHours(23, 59, 59, 999)

  const supabase = createAdminClient()

  const [{ data: appointments }, { data: staff }] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        'id, title, start_time, end_time, status, notes, contacts(full_name), staff_members!appointments_assigned_staff_id_fkey(id, name, color_hex)'
      )
      .eq('tenant_id', tenantId)
      .gte('start_time', windowStart.toISOString())
      .lte('start_time', windowEnd.toISOString())
      .order('start_time', { ascending: true })
      .returns<Appointment[]>(),
    supabase
      .from('staff_members')
      .select('id, name, color_hex')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .returns<StaffMember[]>(),
  ])

  return (
    <AppointmentsCalendar
      tenantId={tenantId}
      initialAppointments={appointments ?? []}
      staff={staff ?? []}
      userRole={userRole}
    />
  )
}
