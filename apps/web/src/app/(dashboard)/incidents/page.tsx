import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import IncidentsBoard from '@/components/incidents/IncidentsBoard'

export default async function IncidentsPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['incidents'] === false) redirect('/dashboard')

  return <IncidentsBoard />
}
