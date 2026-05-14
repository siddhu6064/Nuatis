import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import PipelinesContent from './PipelinesContent'

export default async function PipelinesPage() {
  const session = await auth()
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

  return <PipelinesContent vertical={vertical} />
}
