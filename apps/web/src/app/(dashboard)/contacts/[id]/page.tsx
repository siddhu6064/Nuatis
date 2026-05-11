import { Suspense } from 'react'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import ContactDetailClient from './ContactDetailClient'
import ContactHeader from './ContactHeader'

interface Contact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  phone_alt: string | null
  source: string | null
  referral_source_detail: string | null
  pipeline_stage: string | null
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
      'id, full_name, email, phone, phone_alt, source, referral_source_detail, pipeline_stage, tags, notes, created_at, last_contacted'
    )
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()
    .returns<Contact>()

  if (!contact) notFound()

  return (
    <div className="px-8 py-8">
      {/* Back link */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/contacts" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Contacts
        </Link>
      </div>

      {/* Header — client component manages local contact state + edit drawer */}
      <ContactHeader
        contact={{
          id: contact.id,
          full_name: contact.full_name,
          email: contact.email,
          phone: contact.phone,
          phone_alt: contact.phone_alt,
          source: contact.source,
          referral_source_detail: contact.referral_source_detail,
          tags: contact.tags ?? [],
          notes: contact.notes,
          pipeline_stage: contact.pipeline_stage,
        }}
      />

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
      <Suspense fallback={null}>
        <ContactDetailClient contactId={contact.id} contactName={contact.full_name} />
      </Suspense>
    </div>
  )
}
