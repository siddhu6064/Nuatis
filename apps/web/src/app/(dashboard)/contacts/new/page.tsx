import { auth } from '@/lib/auth/authjs'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AddContactForm from './AddContactForm'

export default async function NewContactPage() {
  const session = await auth()
  if (!session?.user?.tenantId) redirect('/sign-in')

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-ink4 mb-3">
          <Link href="/contacts" className="hover:text-ink3 transition-colors">
            Contacts
          </Link>
          <span>›</span>
          <span className="text-ink3">New Contact</span>
        </div>
        <h1 className="text-xl font-bold text-ink">Add Contact</h1>
        <p className="text-sm text-ink3 mt-0.5">Create a new contact record</p>
      </div>

      <AddContactForm />
    </div>
  )
}
