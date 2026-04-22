import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { VERTICALS } from '@nuatis/shared'
import StaffPage from '@/components/staff/StaffPage'

export default async function StaffPageRoute() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['crm'] === false) redirect('/dashboard')

  const vertical = session?.user?.vertical || 'sales_crm'
  const cfg = VERTICALS[vertical]
  const pageTitle = cfg?.staff_label ?? 'Staff'

  return <StaffPage pageTitle={pageTitle} />
}
