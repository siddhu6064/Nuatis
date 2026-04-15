import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import ContactDetailClient from './ContactDetailClient'

interface Contact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  pipeline_stage: string | null
  source: string | null
  tags: string[]
  notes: string | null
  created_at: string
  last_contacted: string | null
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const tenantId = session?.user?.tenantId

  if (!tenantId) notFound()

  const supabase = createAdminClient()
  const { data: contact } = await supabase
    .from('contacts')
    .select(
      'id, full_name, email, phone, pipeline_stage, source, tags, notes, created_at, last_contacted'
    )
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()
    .returns<Contact>()

  if (!contact) notFound()

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/contacts" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Contacts
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
          <span className="text-teal-700 text-lg font-bold">
            {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </span>
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{contact.full_name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
            {contact.email && <span>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.pipeline_stage && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
                {contact.pipeline_stage}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Contact Info Card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Source</span>
            <p className="text-gray-700">{contact.source?.replace('_', ' ') ?? '---'}</p>
          </div>
          <div>
            <span className="text-gray-400">Added</span>
            <p className="text-gray-700">
              {new Date(contact.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          {contact.last_contacted && (
            <div>
              <span className="text-gray-400">Last Contacted</span>
              <p className="text-gray-700">
                {new Date(contact.last_contacted).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          )}
          {contact.tags && contact.tags.length > 0 && (
            <div>
              <span className="text-gray-400">Tags</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {contact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Client-side interactive sections */}
      <ContactDetailClient contactId={contact.id} contactName={contact.full_name} />
    </div>
  )
}
