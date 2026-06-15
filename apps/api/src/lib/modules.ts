import { createClient } from '@supabase/supabase-js'
import { defaultEntitlement } from '../config/stripe-plans.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function isModuleEnabled(tenantId: string, module: string): Promise<boolean> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('tenants')
    .select('modules, subscription_plan, product')
    .eq('id', tenantId)
    .single()

  const modules = data?.modules as Record<string, boolean> | null | undefined
  // Unprovisioned tenant or query error (data null) → fail closed to maya-only.
  if (!modules) return module === 'maya'

  // An explicitly stored boolean wins — true OR false (toggle / comp override).
  const v = modules[module]
  if (typeof v === 'boolean') return v

  // No explicit flag → derive entitlement from plan + product.
  const plan = (data?.subscription_plan as string | null) ?? null
  const product = (data?.product as string | null) ?? null
  return defaultEntitlement(module, plan, product)
}
