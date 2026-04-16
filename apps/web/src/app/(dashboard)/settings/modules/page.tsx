import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import ModuleSettings from './ModuleSettings'

export default async function ModulesPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const isOwner = session?.user?.role === 'owner'
  const vertical = session?.user?.vertical ?? 'sales_crm'

  const supabase = createAdminClient()
  const { data } = await supabase.from('tenants').select('modules').eq('id', tenantId).single()

  const modules = (data?.modules as Record<string, boolean>) ?? {}

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Modules</h1>
      <p className="text-sm text-gray-500 mb-6">
        Choose which features are visible in your workspace
      </p>
      <ModuleSettings initialModules={modules} isOwner={isOwner} vertical={vertical} />
    </div>
  )
}
