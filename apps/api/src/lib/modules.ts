import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function isModuleEnabled(tenantId: string, module: string): Promise<boolean> {
  const supabase = getSupabase()
  const { data } = await supabase.from('tenants').select('modules').eq('id', tenantId).single()

  const modules = data?.modules as Record<string, boolean> | null
  if (!modules) return true // fail open — don't block if data missing
  return modules[module] !== false
}
