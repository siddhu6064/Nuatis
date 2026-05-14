import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { Suspense } from 'react'
import PipelineContent from './PipelineContent'

export default async function PipelinePage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['pipeline'] === false) redirect('/dashboard')

  const tenantId = session?.user?.tenantId as string | undefined

  let vertical = 'sales_crm'
  if (tenantId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('tenants')
      .select('vertical')
      .eq('id', tenantId)
      .single<{ vertical: string }>()
    if (data?.vertical) vertical = data.vertical
  }

  return (
    <Suspense fallback={null}>
      <PipelineContent vertical={vertical} />
    </Suspense>
  )
}
