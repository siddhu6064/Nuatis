'use server'

import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createAppointment(formData: FormData) {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error('Unauthorized')

  const title = formData.get('title') as string
  const contactId = formData.get('contact_id') as string | null
  const date = formData.get('date') as string
  const startTime = formData.get('start_time') as string
  const endTime = formData.get('end_time') as string
  const notes = formData.get('notes') as string | null

  if (!title || !date || !startTime || !endTime) {
    throw new Error('Title, date, start time, and end time are required')
  }

  const startDatetime = new Date(`${date}T${startTime}`)
  const endDatetime = new Date(`${date}T${endTime}`)

  const supabase = createAdminClient()
  const { error } = await supabase.from('appointments').insert({
    tenant_id: session.user.tenantId,
    contact_id: contactId || null,
    title: title.trim(),
    start_time: startDatetime.toISOString(),
    end_time: endDatetime.toISOString(),
    status: 'scheduled',
    notes: notes?.trim() || null,
  })

  if (error) throw new Error(error.message)

  redirect('/appointments')
}
