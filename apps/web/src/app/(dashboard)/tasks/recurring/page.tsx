import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RecurringTasksClient from './RecurringTasksClient'

interface Contact {
  id: string
  full_name: string
}

export default async function RecurringTasksPage() {
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
          <Link href="/tasks" className="hover:text-ink3 transition-colors">
            Tasks
          </Link>
          <span>›</span>
          <span className="text-ink3">Recurring</span>
        </div>
        <h1 className="text-xl font-bold text-ink">Recurring Tasks</h1>
        <p className="text-sm text-ink3 mt-0.5">
          A standing to-do gets recreated automatically instead of by hand every time.
        </p>
      </div>

      <RecurringTasksClient contacts={contacts ?? []} />
    </div>
  )
}
