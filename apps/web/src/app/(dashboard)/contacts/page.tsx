import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface Contact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  pipeline_stage: string | null
  created_at: string
}

export default async function ContactsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name, email, phone, pipeline_stage, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .returns<Contact[]>()

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-0.5">{contacts?.length ?? 0} total</p>
        </div>
        <Link
          href="/contacts/new"
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Add Contact
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        {!contacts || contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◎</span>
            </div>
            <p className="text-sm font-medium text-gray-400">No contacts yet</p>
            <p className="text-xs text-gray-300 mt-1">Add your first contact to get started</p>
            <Link
              href="/contacts/new"
              className="mt-4 text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              Add Contact →
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Email</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Phone</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Stage</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                        <span className="text-teal-700 text-xs font-bold">
                          {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{contact.full_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{contact.email ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{contact.phone ?? '—'}</td>
                  <td className="px-6 py-4">
                    {contact.pipeline_stage ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
                        {contact.pipeline_stage}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
