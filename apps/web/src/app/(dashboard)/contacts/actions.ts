'use server'

import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createContact(formData: FormData) {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error('Unauthorized')

  const full_name = (formData.get('full_name') as string)?.trim()
  if (!full_name) throw new Error('Full name is required')

  const email = (formData.get('email') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null

  const supabase = createAdminClient()
  const { error } = await supabase.from('contacts').insert({
    tenant_id: session.user.tenantId,
    full_name,
    email,
    phone,
  })

  if (error) throw new Error(error.message)
  redirect('/contacts')
}
