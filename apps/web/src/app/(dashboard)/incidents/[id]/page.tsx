import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import IncidentDetail from '@/components/incidents/IncidentDetail'

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['incidents'] === false) redirect('/dashboard')

  const { id } = await params
  return <IncidentDetail incidentId={id} />
}
