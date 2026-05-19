import { Suspense } from 'react'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ContactDetailClient from './ContactDetailClient'

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
    <Suspense fallback={null}>
      <ContactDetailClient
        contact={{
          id: contact.id,
          full_name: contact.full_name,
          email: contact.email,
          phone: contact.phone,
          phone_alt: contact.phone_alt,
          source: contact.source,
          referral_source_detail: contact.referral_source_detail,
          pipeline_stage: contact.pipeline_stage,
          tags: contact.tags ?? [],
          notes: contact.notes,
          created_at: contact.created_at,
          last_contacted: contact.last_contacted,
        }}
      />
    </Suspense>
  )
}
