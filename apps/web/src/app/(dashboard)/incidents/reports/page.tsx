import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import IncidentReports from '@/components/incidents/IncidentReports'

export default async function IncidentReportsPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['incidents'] === false) redirect('/dashboard')

  return <IncidentReports />
}
