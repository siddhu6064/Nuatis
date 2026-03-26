'use server'

import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateContactStage(contactId: string, stage: string) {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error('Unauthorized')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('contacts')
    .update({ pipeline_stage: stage })
    .eq('id', contactId)
    .eq('tenant_id', session.user.tenantId) // scoped to tenant — belt + suspenders

  if (error) throw new Error(error.message)
  revalidatePath('/pipeline')
}
